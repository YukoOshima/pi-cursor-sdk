/**
 * Local ToolDefinition facades for native Cursor replay wrapping.
 *
 * omp `@oh-my-pi/pi-coding-agent` does not export create*ToolDefinition helpers
 * from the package root (legacy shim is Bun/.ts-only). These facades provide
 * enough name/parameters/execute/renderCall/renderResult shape for
 * wrapNativeCursorTool and focused vitest baselines.
 */

import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import { spawn } from "node:child_process";
import { Text } from "@oh-my-pi/pi-tui";
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { Type, type Static } from "typebox";

/** Use `any` for params so typebox schemas satisfy omp ToolDefinition without forcing typebox into pi-ai TSchema. */
type HostToolDefinition = ToolDefinition<any, unknown>;

type ThemeLike = {
	fg?: (style: string, text: string) => string;
	bold?: (text: string) => string;
};

function isThemeLike(value: unknown): value is ThemeLike {
	return Boolean(value && typeof value === "object" && ("fg" in value || "bold" in value));
}

function resolveTheme(second: unknown, third: unknown): ThemeLike {
	if (isThemeLike(second)) return second;
	if (isThemeLike(third)) return third;
	return {};
}

function themedTitle(theme: ThemeLike, title: string): string {
	const bold = theme.bold?.(title) ?? title;
	return theme.fg?.("toolTitle", bold) ?? bold;
}

function themedMuted(theme: ThemeLike, text: string): string {
	return theme.fg?.("toolOutput", text) ?? text;
}

function themedAccent(theme: ThemeLike, text: string): string {
	return theme.fg?.("accent", text) ?? text;
}

function expandHome(filePath: string): string {
	if (filePath === "~") return homedir();
	if (filePath.startsWith(`~/`) || filePath.startsWith(`~${sep}`)) {
		return join(homedir(), filePath.slice(2));
	}
	return filePath;
}

function resolveToCwd(filePath: string, cwd: string): string {
	const expanded = expandHome(filePath.trim());
	if (isAbsolute(expanded)) return resolvePath(expanded);
	return resolvePath(cwd, expanded);
}

function displayPath(filePath: string | undefined, cwd: string, emptyFallback = "."): string {
	if (!filePath) return emptyFallback;
	const absolute = resolveToCwd(filePath, cwd);
	const rel = relative(cwd, absolute);
	if (!rel || rel === "") return ".";
	if (rel.startsWith("..")) return absolute;
	return rel;
}

function textResult(text: string, details?: unknown) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

function emptyTextComponent(): Text {
	return new Text("", 0, 0);
}

function callText(theme: ThemeLike, title: string, detail: string): Text {
	return new Text(`${themedTitle(theme, title)} ${themedMuted(theme, detail)}`, 0, 0);
}

function resultText(result: { content?: Array<{ type: string; text?: string }> } | undefined, isError?: boolean): Text {
	const text =
		result?.content
			?.map((entry) => (entry.type === "text" ? entry.text ?? "" : ""))
			.filter(Boolean)
			.join("\n") ?? "";
	if (!text) return emptyTextComponent();
	const prefix = isError ? "error: " : "";
	return new Text(`${prefix}${text}`, 0, 0);
}

const replaceEditSchema = Type.Object({
	oldText: Type.String({ description: "Exact text for one targeted replacement." }),
	newText: Type.String({ description: "Replacement text for this targeted edit." }),
});

const editSchema = Type.Object({
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	edits: Type.Array(replaceEditSchema, {
		description: "One or more targeted replacements matched against the original file.",
	}),
});

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" })),
});

const findSchema = Type.Object({
	pattern: Type.String({ description: "Glob pattern to match files" }),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

const grepSchema = Type.Object({
	pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern" })),
	ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
	literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex" })),
	context: Type.Optional(Type.Number({ description: "Lines of context around each match" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
});

const lsSchema = Type.Object({
	path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
});

type EditInput = Static<typeof editSchema>;
type WriteInput = Static<typeof writeSchema>;
type ReadInput = Static<typeof readSchema>;
type BashInput = Static<typeof bashSchema>;
type FindInput = Static<typeof findSchema>;
type GrepInput = Static<typeof grepSchema>;
type LsInput = Static<typeof lsSchema>;

function applyExactEdits(content: string, edits: EditInput["edits"], path: string): string {
	const matches: Array<{ index: number; length: number; newText: string; editIndex: number }> = [];
	for (let i = 0; i < edits.length; i++) {
		const edit = edits[i]!;
		if (!edit.oldText) {
			throw new Error(`edits[${i}].oldText must be non-empty in ${path}`);
		}
		const index = content.indexOf(edit.oldText);
		if (index < 0) {
			throw new Error(`Could not find edits[${i}].oldText in ${path}`);
		}
		const second = content.indexOf(edit.oldText, index + edit.oldText.length);
		if (second >= 0) {
			throw new Error(`edits[${i}].oldText matched multiple times in ${path}`);
		}
		matches.push({ index, length: edit.oldText.length, newText: edit.newText, editIndex: i });
	}
	matches.sort((a, b) => a.index - b.index);
	for (let i = 1; i < matches.length; i++) {
		const prev = matches[i - 1]!;
		const curr = matches[i]!;
		if (prev.index + prev.length > curr.index) {
			throw new Error(`edits[${prev.editIndex}] and edits[${curr.editIndex}] overlap in ${path}`);
		}
	}
	let result = content;
	for (let i = matches.length - 1; i >= 0; i--) {
		const match = matches[i]!;
		result = result.slice(0, match.index) + match.newText + result.slice(match.index + match.length);
	}
	return result;
}

async function runBash(command: string, cwd: string, timeoutSeconds?: number, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Operation aborted"));
			return;
		}
		const child = spawn(command, {
			cwd,
			shell: true,
			env: process.env,
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (error?: Error, output?: string) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			if (error) reject(error);
			else resolve(output ?? "");
		};
		const onAbort = () => {
			child.kill("SIGTERM");
			finish(new Error("Operation aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		const timer =
			timeoutSeconds && timeoutSeconds > 0
				? setTimeout(() => {
						child.kill("SIGTERM");
						finish(new Error(`Command timed out after ${timeoutSeconds}s`));
					}, timeoutSeconds * 1000)
				: undefined;
		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => finish(error));
		child.on("close", (code) => {
			const combined = [stdout, stderr].filter(Boolean).join(stdout && stderr ? "\n" : "");
			if (code && code !== 0) {
				finish(new Error(combined || `Command exited with code ${code}`));
				return;
			}
			finish(undefined, combined || "(no output)");
		});
	});
}

function matchGlob(filePath: string, pattern: string): boolean {
	const normalized = filePath.split(sep).join("/");
	const escaped = pattern
		.split(sep)
		.join("/")
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "{{GLOBSTAR}}")
		.replace(/\*/g, "[^/]*")
		.replace(/\?/g, "[^/]")
		.replace(/{{GLOBSTAR}}/g, ".*");
	return new RegExp(`^${escaped}$`).test(normalized) || new RegExp(`(^|/)${escaped}$`).test(normalized);
}

async function walkFiles(root: string, limit: number): Promise<string[]> {
	const results: string[] = [];
	const queue = [root];
	while (queue.length > 0 && results.length < limit) {
		const current = queue.shift()!;
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (results.length >= limit) break;
			if (entry.name === ".git" || entry.name === "node_modules") continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) queue.push(full);
			else if (entry.isFile()) results.push(full);
		}
	}
	return results;
}

export function createEditToolDefinition(cwd: string): HostToolDefinition {
	return {
		name: "edit",
		label: "edit",
		description: "Edit a single file using exact text replacement.",
		parameters: editSchema,
		approval: "write",
		async execute(_toolCallId, input) {
			const { path, edits } = input as EditInput;
			const absolutePath = resolveToCwd(path, cwd);
			await access(absolutePath);
			const raw = await readFile(absolutePath, "utf8");
			const next = applyExactEdits(raw, edits, path);
			await writeFile(absolutePath, next, "utf8");
			return textResult(`Successfully replaced ${edits.length} block(s) in ${path}.`);
		},
		renderCall(args, second, third) {
			const theme = resolveTheme(second, third);
			const path = typeof (args as EditInput | undefined)?.path === "string" ? (args as EditInput).path : "";
			return callText(theme, "edit", displayPath(path, cwd));
		},
		renderResult(result, options) {
			return resultText(result, Boolean(result?.isError ?? (options as { isError?: boolean } | undefined)?.isError));
		},
	} as HostToolDefinition;
}

export function createWriteToolDefinition(cwd: string): HostToolDefinition {
	return {
		name: "write",
		label: "write",
		description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
		parameters: writeSchema,
		approval: "write",
		async execute(_toolCallId, input) {
			const { path, content } = input as WriteInput;
			const absolutePath = resolveToCwd(path, cwd);
			await mkdir(dirname(absolutePath), { recursive: true });
			await writeFile(absolutePath, content, "utf8");
			return textResult(`Successfully wrote ${content.length} bytes to ${path}`);
		},
		renderCall(args, second, third) {
			const theme = resolveTheme(second, third);
			const path = typeof (args as WriteInput | undefined)?.path === "string" ? (args as WriteInput).path : "";
			return callText(theme, "write", displayPath(path, cwd));
		},
		renderResult(result, options) {
			return resultText(result, Boolean(result?.isError ?? (options as { isError?: boolean } | undefined)?.isError));
		},
	} as HostToolDefinition;
}

export function createReadToolDefinition(cwd: string): HostToolDefinition {
	return {
		name: "read",
		label: "read",
		description: "Read the contents of a file.",
		parameters: readSchema,
		approval: "read",
		async execute(_toolCallId, input) {
			const { path, offset, limit } = input as ReadInput;
			const absolutePath = resolveToCwd(path, cwd);
			await access(absolutePath);
			const raw = await readFile(absolutePath, "utf8");
			const lines = raw.split("\n");
			const start = offset ? Math.max(0, offset - 1) : 0;
			if (start >= lines.length) {
				throw new Error(`Offset ${offset} is beyond end of file (${lines.length} lines total)`);
			}
			const selected = limit === undefined ? lines.slice(start) : lines.slice(start, start + limit);
			return textResult(selected.join("\n"));
		},
		renderCall(args, second, third) {
			const theme = resolveTheme(second, third);
			const path = typeof (args as ReadInput | undefined)?.path === "string" ? (args as ReadInput).path : "";
			return callText(theme, "read", displayPath(path, cwd));
		},
		renderResult(result, options) {
			return resultText(result, Boolean(result?.isError ?? (options as { isError?: boolean } | undefined)?.isError));
		},
	} as HostToolDefinition;
}

export function createBashToolDefinition(cwd: string): HostToolDefinition {
	return {
		name: "bash",
		label: "bash",
		description: "Execute a bash command in the current working directory.",
		parameters: bashSchema,
		approval: "exec",
		async execute(_toolCallId, input, signal) {
			const { command, timeout } = input as BashInput;
			const output = await runBash(command, cwd, timeout, signal);
			return textResult(output);
		},
		renderCall(args, second, third) {
			const theme = resolveTheme(second, third);
			const command = typeof (args as BashInput | undefined)?.command === "string" ? (args as BashInput).command : "";
			return callText(theme, "bash", command);
		},
		renderResult(result, options) {
			return resultText(result, Boolean(result?.isError ?? (options as { isError?: boolean } | undefined)?.isError));
		},
	} as HostToolDefinition;
}

export function createFindToolDefinition(cwd: string): HostToolDefinition {
	return {
		name: "find",
		label: "find",
		description: "Find files by glob pattern.",
		parameters: findSchema,
		approval: "read",
		async execute(_toolCallId, input) {
			const { pattern, path, limit } = input as FindInput;
			const root = resolveToCwd(path ?? ".", cwd);
			const max = limit ?? 1000;
			const files = await walkFiles(root, max * 4);
			const matches = files
				.map((file) => relative(root, file).split(sep).join("/"))
				.filter((file) => matchGlob(file, pattern) || matchGlob(file.split("/").pop() ?? file, pattern))
				.slice(0, max);
			return textResult(matches.join("\n") || "(no matches)");
		},
		renderCall(args, second, third) {
			const theme = resolveTheme(second, third);
			const pattern = typeof (args as FindInput | undefined)?.pattern === "string" ? (args as FindInput).pattern : "";
			const searchPath = displayPath((args as FindInput | undefined)?.path, cwd);
			return new Text(
				`${themedTitle(theme, "find")} ${themedAccent(theme, pattern)} ${themedMuted(theme, `in ${searchPath}`)}`,
				0,
				0,
			);
		},
		renderResult(result, options) {
			return resultText(result, Boolean(result?.isError ?? (options as { isError?: boolean } | undefined)?.isError));
		},
	} as HostToolDefinition;
}

export function createGrepToolDefinition(cwd: string): HostToolDefinition {
	return {
		name: "grep",
		label: "grep",
		description: "Search file contents by pattern.",
		parameters: grepSchema,
		approval: "read",
		async execute(_toolCallId, input) {
			const { pattern, path, ignoreCase, literal, limit } = input as GrepInput;
			const root = resolveToCwd(path ?? ".", cwd);
			const max = limit ?? 100;
			const rootStat = await stat(root);
			const files = rootStat.isDirectory() ? await walkFiles(root, 2000) : [root];
			const source = literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
			const regex = new RegExp(source, ignoreCase ? "i" : undefined);
			const matches: string[] = [];
			for (const file of files) {
				if (matches.length >= max) break;
				let content: string;
				try {
					content = await readFile(file, "utf8");
				} catch {
					continue;
				}
				const lines = content.split("\n");
				for (let i = 0; i < lines.length; i++) {
					if (matches.length >= max) break;
					const line = lines[i]!;
					if (regex.test(line)) {
						matches.push(`${relative(cwd, file)}:${i + 1}:${line}`);
					}
				}
			}
			return textResult(matches.join("\n") || "(no matches)");
		},
		renderCall(args, second, third) {
			const theme = resolveTheme(second, third);
			const pattern = typeof (args as GrepInput | undefined)?.pattern === "string" ? (args as GrepInput).pattern : "";
			const searchPath = displayPath((args as GrepInput | undefined)?.path, cwd);
			return new Text(
				`${themedTitle(theme, "grep")} ${themedAccent(theme, `/${pattern}/`)} ${themedMuted(theme, `in ${searchPath}`)}`,
				0,
				0,
			);
		},
		renderResult(result, options) {
			return resultText(result, Boolean(result?.isError ?? (options as { isError?: boolean } | undefined)?.isError));
		},
	} as HostToolDefinition;
}

export function createLsToolDefinition(cwd: string): HostToolDefinition {
	return {
		name: "ls",
		label: "ls",
		description: "List directory entries.",
		parameters: lsSchema,
		approval: "read",
		async execute(_toolCallId, input) {
			const { path, limit } = input as LsInput;
			const root = resolveToCwd(path ?? ".", cwd);
			const max = limit ?? 500;
			const entries = await readdir(root, { withFileTypes: true });
			const lines = entries
				.slice(0, max)
				.map((entry) => `${entry.isDirectory() ? "dir" : "file"}\t${entry.name}`);
			return textResult(lines.join("\n") || "(empty)");
		},
		renderCall(args, second, third) {
			const theme = resolveTheme(second, third);
			return callText(theme, "ls", displayPath((args as LsInput | undefined)?.path, cwd));
		},
		renderResult(result, options) {
			return resultText(result, Boolean(result?.isError ?? (options as { isError?: boolean } | undefined)?.isError));
		},
	} as HostToolDefinition;
}

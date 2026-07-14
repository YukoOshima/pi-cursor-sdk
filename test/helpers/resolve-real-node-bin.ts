import { existsSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";

export function isBunPath(path: string): boolean {
	return /(?:^|[/\\])bun(?:\.exe)?$/i.test(path) || /(?:^|[/\\])bun-node-/i.test(path);
}

/**
 * Resolve a real Node.js binary for Node-only CLI probes (`node --check`, `--import` loaders).
 * Under `bun --bun vitest`, `process.execPath` is bun and PATH may shim `node` -> bun.
 */
export function resolveRealNodeBin(): string {
	const candidates: string[] = [];
	const fromEnv = process.env.NODE_BINARY || process.env.npm_node_execpath;
	if (fromEnv) candidates.push(fromEnv);
	if (!isBunPath(process.execPath)) candidates.push(process.execPath);

	for (const dir of (process.env.PATH || "").split(delimiter)) {
		if (!dir || /bun-node-/i.test(dir) || isBunPath(dir)) continue;
		candidates.push(`${dir.replace(/[/\\]+$/, "")}/node`);
	}

	for (const candidate of candidates) {
		try {
			if (!candidate || isBunPath(candidate)) continue;
			// Prefer absolute paths so spawn bypasses PATH shims.
			if (!(candidate.includes("/") || candidate.includes("\\"))) continue;
			if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
			const real = realpathSync(candidate);
			if (isBunPath(real)) continue;
			const probe = spawnSync(real, ["-p", "typeof process.versions.bun === \"undefined\""], {
				encoding: "utf8",
			});
			if (probe.status === 0 && probe.stdout.trim() === "true") return real;
		} catch {
			// try next candidate
		}
	}

	throw new Error("Could not resolve a real Node.js binary (bun shims are not usable for Node CLI probes)");
}

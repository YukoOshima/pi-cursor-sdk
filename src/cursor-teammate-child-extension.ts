import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURSOR_ASK_QUESTION_TOOL_NAME } from "./cursor-question-tool.js";
import { CURSOR_ACTIVATE_SKILL_TOOL_NAME } from "./cursor-skill-tool.js";

/**
 * Same globalThis key as `pi-maestro-teammate` `child-extensions.ts`.
 * Written without importing that package so this extension stays optional.
 */
export const PI_MAESTRO_TEAMMATE_CHILD_EXTENSIONS_KEY = Symbol.for("pi-maestro-teammate.child-extensions");

export const CURSOR_TEAMMATE_CHILD_TOOL_NAMES = [
	CURSOR_ASK_QUESTION_TOOL_NAME,
	CURSOR_ACTIVATE_SKILL_TOOL_NAME,
] as const;

interface TeammateChildExtensionRegistration {
	path: string;
	tools: readonly string[];
}

interface TeammateChildExtensionRegistry {
	registrations: Map<symbol, TeammateChildExtensionRegistration>;
}

function pathKey(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

function getTeammateChildExtensionRegistry(): TeammateChildExtensionRegistry | undefined {
	const globals = globalThis as typeof globalThis & Record<symbol, unknown>;
	const registry = globals[PI_MAESTRO_TEAMMATE_CHILD_EXTENSIONS_KEY] as TeammateChildExtensionRegistry | undefined;
	if (!registry?.registrations || typeof registry.registrations.set !== "function") return undefined;
	return registry;
}

/**
 * Contribute this package's entry to maestro teammate child spawns.
 *
 * Teammate children start with `--mode rpc --no-extensions` and only load
 * paths from this registry. Without this registration, `cursor/*` models
 * disappear in children even when the parent session uses Cursor.
 *
 * Returns false when pi-maestro-teammate is not loaded yet.
 */
export function registerCursorSdkTeammateChildExtension(extensionPath: string): boolean {
	const normalizedPath = extensionPath.trim();
	if (!normalizedPath) return false;
	const registry = getTeammateChildExtensionRegistry();
	if (!registry) return false;

	for (const [token, registration] of registry.registrations) {
		if (pathKey(registration.path) === pathKey(normalizedPath)) {
			registry.registrations.delete(token);
		}
	}
	registry.registrations.set(Symbol(normalizedPath), {
		path: normalizedPath,
		tools: [...CURSOR_TEAMMATE_CHILD_TOOL_NAMES],
	});
	return true;
}

export function registerCursorSdkTeammateChildExtensionFromEntry(entryHref: string): boolean {
	return registerCursorSdkTeammateChildExtension(fileURLToPath(entryHref));
}

export function registerCursorTeammateChildExtensionLifecycle(
	pi: Pick<ExtensionAPI, "on">,
	entryHref: string,
): void {
	const sync = (): boolean => registerCursorSdkTeammateChildExtensionFromEntry(entryHref);
	sync();
	// maestro-flow plants the registry at the end of its own `session_start`
	// handler. This package typically loads first, so `session_start` alone
	// can miss. `before_agent_start` runs after those handlers settle.
	pi.on("session_start", () => {
		sync();
	});
	pi.on("before_agent_start", () => {
		sync();
	});
}

export const __testUtils = {
	pathKey,
	getRegistry: getTeammateChildExtensionRegistry,
};

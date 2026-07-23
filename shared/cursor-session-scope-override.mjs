/**
 * AsyncLocalStorage override for Cursor session scope.
 *
 * Stored on globalThis so both this ESM shim (for in-process callers such as
 * pi-dynamic-workflows) and `src/cursor-session-scope.ts` share ONE store
 * without a TS→mjs static import.
 *
 * Workflow subagents run with `noExtensions: true`, so they never fire this
 * extension's `session_start` handler and would otherwise inherit the host
 * session scope — serializing all Cursor turns onto one FIFO (see 0.1.52).
 * Callers that own an isolated AgentSession should wrap their prompt/turn in
 * `runWithCursorSessionScopeOverride({ sessionId, cwd }, fn)`.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const GLOBAL_KEY = "__pi_cursor_session_scope_als__";

function getAls() {
	const g = globalThis;
	if (!g[GLOBAL_KEY]) {
		g[GLOBAL_KEY] = new AsyncLocalStorage();
	}
	return g[GLOBAL_KEY];
}

export function getCursorSessionScopeOverride() {
	return getAls().getStore();
}

export function runWithCursorSessionScopeOverride(override, fn) {
	return getAls().run(override, fn);
}

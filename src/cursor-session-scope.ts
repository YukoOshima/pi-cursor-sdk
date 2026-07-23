import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import { parseArgs } from "@earendil-works/pi-coding-agent";
import type { ExtensionHandler, ProjectTrustHandler, SessionInfoChangedEvent, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { truncateCursorDisplayLine } from "./cursor-display-text.js";

/** Per-async-context Cursor session scope override (in-process subagent isolation). */
export interface CursorSessionScopeOverride {
	sessionId?: string;
	sessionFile?: string;
	cwd?: string;
	projectTrusted?: boolean;
	sessionName?: string;
}

const GLOBAL_ALS_KEY = "__pi_cursor_session_scope_als__";

function getScopeOverrideAls(): AsyncLocalStorage<CursorSessionScopeOverride> {
	const g = globalThis as typeof globalThis & {
		[GLOBAL_ALS_KEY]?: AsyncLocalStorage<CursorSessionScopeOverride>;
	};
	if (!g[GLOBAL_ALS_KEY]) {
		g[GLOBAL_ALS_KEY] = new AsyncLocalStorage<CursorSessionScopeOverride>();
	}
	return g[GLOBAL_ALS_KEY];
}

function getCursorSessionScopeOverride(): CursorSessionScopeOverride | undefined {
	return getScopeOverrideAls().getStore();
}

/** Run `fn` with an isolated Cursor session scope (own turn queue + SDKAgent pool). */
export function runWithCursorSessionScopeOverride<T>(
	override: CursorSessionScopeOverride,
	fn: () => T,
): T {
	return getScopeOverrideAls().run(override, fn);
}

interface CursorSessionScopeExtensionApi {
	on(event: "project_trust", handler: ProjectTrustHandler): void;
	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
	on(event: "session_info_changed", handler: ExtensionHandler<SessionInfoChangedEvent>): void;
}

const ANONYMOUS_SESSION_SCOPE_KEY = "__anonymous__";
const EPHEMERAL_SESSION_SCOPE_PREFIX = "__ephemeral__:";
export const MAX_CURSOR_SESSION_NAME_LENGTH = 100;

type CursorSessionScopeChangeHandler = (previousScopeKey: string) => Promise<void> | void;

const state = {
	sessionCwd: process.cwd(),
	sessionFile: undefined as string | undefined,
	sessionId: undefined as string | undefined,
	sessionName: undefined as string | undefined,
	projectTrusted: false,
	sessionGeneration: 0,
};

const scopeGenerations = new Map<string, number>([[ANONYMOUS_SESSION_SCOPE_KEY, state.sessionGeneration]]);
const projectTrustResolutionCwds = new Set<string>();
let nextSessionGeneration = 1;
let scopeChangeHandler: CursorSessionScopeChangeHandler | undefined;

/**
 * Pi session file when known; used to scope reused Cursor SDK agents to one pi session.
 * AsyncLocalStorage overrides (in-process subagent sessions) win over the host singleton.
 */
export function getCursorSessionFile(): string | undefined {
	const override = getCursorSessionScopeOverride();
	if (override?.sessionFile) return override.sessionFile;
	if (override?.sessionId) return undefined;
	return state.sessionFile;
}

/**
 * Stable scope key for session-agent pooling. Falls back to a process-local anonymous key
 * before the first session_start (tests and early startup).
 *
 * Prefer an AsyncLocalStorage override when present so in-process AgentSessions that never
 * fire `session_start` (e.g. pi-dynamic-workflows with `noExtensions: true`) each get their
 * own turn queue + SDKAgent pool instead of serializing behind the host session.
 */
export function getCursorSessionScopeKey(): string {
	const override = getCursorSessionScopeOverride();
	if (override?.sessionFile) return override.sessionFile;
	if (override?.sessionId) return `${EPHEMERAL_SESSION_SCOPE_PREFIX}${override.sessionId}`;
	if (state.sessionFile) return state.sessionFile;
	if (state.sessionId) return `${EPHEMERAL_SESSION_SCOPE_PREFIX}${state.sessionId}`;
	return ANONYMOUS_SESSION_SCOPE_KEY;
}

export function getCursorSessionScopeGeneration(scopeKey: string = getCursorSessionScopeKey()): number {
	return scopeGenerations.get(scopeKey) ?? 0;
}

/**
 * Pi session cwd when known; falls back to process.cwd() before session_start.
 * Updated on session_start only until pi threads cwd into streamSimple—mid-session cwd
 * changes without a new session_start event are not reflected here.
 * AsyncLocalStorage overrides (workflow worktrees / isolated subagents) win.
 */
export function getCursorSessionCwd(): string {
	const override = getCursorSessionScopeOverride();
	if (override?.cwd) return override.cwd;
	return state.sessionCwd;
}

export function getCursorSessionProjectTrusted(): boolean {
	return state.projectTrusted;
}

export function getCursorSessionName(): string | undefined {
	return state.sessionName;
}

function normalizeCursorSessionName(name: string | undefined): string | undefined {
	if (name === undefined) return undefined;
	return truncateCursorDisplayLine(name, MAX_CURSOR_SESSION_NAME_LENGTH) || undefined;
}

function setCursorSessionScope(
	cwd: string,
	sessionFile: string | undefined,
	sessionId?: string,
	projectTrusted = false,
	sessionName?: string,
): void {
	state.sessionCwd = cwd;
	state.sessionFile = sessionFile;
	state.sessionId = sessionId;
	state.sessionName = normalizeCursorSessionName(sessionName);
	state.projectTrusted = projectTrusted;
	state.sessionGeneration = nextSessionGeneration;
	nextSessionGeneration += 1;
	scopeGenerations.set(getCursorSessionScopeKey(), state.sessionGeneration);
}

function recordProjectTrustResolution(cwd: string): void {
	projectTrustResolutionCwds.add(resolve(cwd));
}

function isCliProjectTrustApproved(args = process.argv.slice(2)): boolean {
	return parseArgs(args).projectTrustOverride === true;
}

function resetCursorSessionScope(): void {
	state.sessionCwd = process.cwd();
	state.sessionFile = undefined;
	state.sessionId = undefined;
	state.sessionName = undefined;
	state.projectTrusted = false;
	state.sessionGeneration = 0;
	nextSessionGeneration = 1;
	scopeGenerations.clear();
	scopeGenerations.set(ANONYMOUS_SESSION_SCOPE_KEY, state.sessionGeneration);
	projectTrustResolutionCwds.clear();
}

export function onCursorSessionScopeKeyChange(handler: CursorSessionScopeChangeHandler): void {
	scopeChangeHandler = handler;
}

export function registerCursorSessionScope(pi: CursorSessionScopeExtensionApi): void {
	pi.on("project_trust", (event) => {
		recordProjectTrustResolution(event.cwd);
		return { trusted: "undecided" };
	});
	pi.on("session_start", async (_event, ctx) => {
		const previousScopeKey = getCursorSessionScopeKey();
		setCursorSessionScope(
			ctx.cwd,
			ctx.sessionManager?.getSessionFile?.() ?? undefined,
			ctx.sessionManager?.getSessionId?.() ?? undefined,
			ctx.isProjectTrusted?.() === true
				&& (projectTrustResolutionCwds.has(resolve(ctx.cwd)) || isCliProjectTrustApproved()),
			ctx.sessionManager?.getSessionName?.() ?? undefined,
		);
		if (previousScopeKey !== getCursorSessionScopeKey()) {
			await scopeChangeHandler?.(previousScopeKey);
		}
	});
	pi.on("session_info_changed", (event) => {
		state.sessionName = normalizeCursorSessionName(event.name);
	});
}

export const __testUtils = {
	ANONYMOUS_SESSION_SCOPE_KEY,
	EPHEMERAL_SESSION_SCOPE_PREFIX,
	set: setCursorSessionScope,
	recordProjectTrustResolution,
	isCliProjectTrustApproved,
	reset: resetCursorSessionScope,
};

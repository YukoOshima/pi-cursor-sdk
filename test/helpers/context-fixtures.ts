import { vi } from "vitest";
import type { AssistantMessage, AssistantMessageEvent, Context } from "@oh-my-pi/pi-ai";
import {
	ModelRegistry,
	type BuildSystemPromptOptions,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { makeModel } from "./model-fixtures.js";
import type { ExtensionCommandContextOverrides, ExtensionContextOverrides } from "./pi-harness-types.js";

let sharedTestModelRegistry: ModelRegistry | undefined;

function getSharedTestModelRegistry(): ModelRegistry {
	if (!sharedTestModelRegistry) {
		// omp AuthStorage/ModelRegistry no longer expose inMemory(); tests only need a typed stub.
		sharedTestModelRegistry = {
			getAll: () => [],
			getAvailable: () => [],
			getApiKeyForProvider: async () => undefined,
		} as unknown as ModelRegistry;
	}
	return sharedTestModelRegistry;
}

export function createDefaultSystemPromptOptions(cwd: string): BuildSystemPromptOptions {
	return {
		cwd,
	};
}

function createMinimalSessionManager(cwd: string, overrides: Partial<ExtensionContext["sessionManager"]> = {}): ExtensionContext["sessionManager"] {
	return {
		getCwd: vi.fn(() => cwd),
		getSessionDir: vi.fn(() => ""),
		getSessionId: vi.fn(() => "test-session"),
		getSessionFile: vi.fn(() => undefined),
		getLeafId: vi.fn(() => null),
		getLeafEntry: vi.fn(() => undefined),
		getEntry: vi.fn(() => undefined),
		getLabel: vi.fn(() => undefined),
		getBranch: vi.fn(() => []),
		buildContextEntries: vi.fn(() => []),
		getHeader: vi.fn(() => null),
		getEntries: vi.fn(() => []),
		getTree: vi.fn(() => []),
		getSessionName: vi.fn(() => undefined),
		...overrides,
	} as ExtensionContext["sessionManager"];
}

function createMinimalExtensionUi(): ExtensionContext["ui"] {
	return {
		select: vi.fn(async () => undefined),
		confirm: vi.fn(async () => false),
		input: vi.fn(async () => undefined),
		notify: vi.fn(),
		onTerminalInput: vi.fn(() => () => {}),
		setStatus: vi.fn(),
		setWorkingMessage: vi.fn(),
		setWidget: vi.fn(),
		setFooter: vi.fn(),
		setHeader: vi.fn(),
		setTitle: vi.fn(),
		custom: vi.fn(<T>() => Promise.resolve(undefined as T)),
		pasteToEditor: vi.fn(),
		setEditorText: vi.fn(),
		getEditorText: vi.fn(() => ""),
		editor: vi.fn(async () => undefined),
		addAutocompleteProvider: vi.fn(),
		setEditorComponent: vi.fn(),
		theme: {} as ExtensionContext["ui"]["theme"],
		getAllThemes: vi.fn(async () => []),
	} as unknown as ExtensionContext["ui"];
}

function createMinimalModels(model: ExtensionContext["model"]): ExtensionContext["models"] {
	return {
		list: vi.fn(() => (model ? [model] : [])),
		current: vi.fn(() => model),
		resolve: vi.fn(() => model),
		family: vi.fn(() => "test-family"),
	};
}

function resolveHasUI(overrides: ExtensionContextOverrides): boolean {
	if (typeof overrides.hasUI === "boolean") return overrides.hasUI;
	if (overrides.mode === "print" || overrides.mode === "rpc") return false;
	if (overrides.mode === "tui" || overrides.mode === "interactive") return true;
	return true;
}

function createMinimalExtensionContextInternal(overrides: ExtensionContextOverrides = {}): ExtensionContext {
	const cwd = (overrides.cwd as string | undefined) ?? process.cwd();
	const model = (overrides.model as ExtensionContext["model"] | undefined) ?? makeModel("composer-2.5");
	const hasUI = resolveHasUI(overrides);
	const {
		sessionManager: sessionManagerOverrides,
		ui: uiOverrides,
		mode,
		signal,
		isProjectTrusted: _trusted,
		hasUI: _hasUI,
		...restOverrides
	} = overrides;

	const base: ExtensionContext = {
		ui: createMinimalExtensionUi(),
		hasUI,
		cwd,
		sessionManager: createMinimalSessionManager(cwd, sessionManagerOverrides),
		modelRegistry: (overrides.modelRegistry as ExtensionContext["modelRegistry"] | undefined) ?? getSharedTestModelRegistry(),
		model,
		models: (overrides.models as ExtensionContext["models"] | undefined) ?? createMinimalModels(model),
		isIdle: vi.fn(() => true),
		abort: (overrides.abort as ExtensionContext["abort"] | undefined) ?? vi.fn(),
		hasPendingMessages: vi.fn(() => false),
		shutdown: vi.fn(),
		getContextUsage: vi.fn(() => undefined),
		compact: vi.fn(async () => undefined),
		getSystemPrompt: vi.fn(() => ["Be helpful."]),
	};

	return {
		...base,
		...(restOverrides as Partial<ExtensionContext>),
		hasUI,
		// omp removed ExtensionContext.mode/signal; keep wiring for tests and bridge abort.
		...(mode !== undefined ? { mode } : {}),
		...(signal !== undefined ? { signal } : {}),
		ui: {
			...base.ui,
			...(uiOverrides as Partial<ExtensionContext["ui"]> | undefined),
		},
		sessionManager: {
			...base.sessionManager,
			...(sessionManagerOverrides as Partial<ExtensionContext["sessionManager"]> | undefined),
		},
	} as ExtensionContext;
}

function createMinimalExtensionCommandContextInternal(
	overrides: ExtensionCommandContextOverrides = {},
): ExtensionCommandContext {
	const base = createMinimalExtensionContextInternal(overrides) as ExtensionCommandContext;
	return {
		...base,
		waitForIdle: overrides.waitForIdle ?? vi.fn(async () => undefined),
		newSession: overrides.newSession ?? vi.fn(async () => ({ cancelled: false })),
		branch: (overrides.fork as ExtensionCommandContext["branch"] | undefined) ?? vi.fn(async () => ({ cancelled: false })),
		navigateTree: overrides.navigateTree ?? vi.fn(async () => ({ cancelled: false })),
		switchSession: overrides.switchSession ?? vi.fn(async () => ({ cancelled: false })),
		reload: overrides.reload ?? vi.fn(async () => undefined),
		ui: {
			...base.ui,
			...(overrides.ui as Partial<ExtensionContext["ui"]> | undefined),
		},
		sessionManager: {
			...base.sessionManager,
			...(overrides.sessionManager as Partial<ExtensionContext["sessionManager"]> | undefined),
		},
	};
}

export function createExtensionTestContext(ctxOverrides: ExtensionContextOverrides = {}): ExtensionContext {
	return createMinimalExtensionContextInternal(ctxOverrides);
}

export function createExtensionCommandContext(
	ctxOverrides: ExtensionCommandContextOverrides = {},
): ExtensionCommandContext {
	return createMinimalExtensionCommandContextInternal(ctxOverrides);
}

export function makeContext(messages: Context["messages"] = [{ role: "user", content: "Hello", timestamp: 1 }]): Context {
	return {
		systemPrompt: ["Be helpful."],
		messages,
	};
}

export function makeAssistantMessage(text = "Done", timestamp = 2): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "cursor-sdk",
		provider: "cursor",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

export async function collectEvents<TEvent>(stream: AsyncIterable<TEvent>): Promise<TEvent[]> {
	const events: TEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

export async function collectAssistantEvents(
	stream: AsyncIterable<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> {
	return collectEvents(stream);
}

import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";

function makeProviderLoadErrorMessage(model: Model<Api>, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		timestamp: Date.now(),
		errorMessage: `Failed to load Cursor provider runtime: ${error instanceof Error ? error.message : String(error)}`,
	};
}

/**
 * Shared provider runtime load. Started once at module init so parallel
 * streamCursorLazy calls (workflow fan-out) await the same promise instead of
 * racing Pi's TS loader through a partially-evaluated circular module graph —
 * which previously surfaced as `Cannot read properties of undefined (reading
 * 'CursorProviderTurnRunner')` when in-process subagents stopped sharing one
 * Cursor turn-queue scope.
 */
const cursorProviderRuntime = import("./cursor-provider.js");

export function streamCursorLazy(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const outer = createAssistantMessageEventStream();
	queueMicrotask(async () => {
		try {
			const { streamCursor } = await cursorProviderRuntime;
			for await (const event of streamCursor(model, context, options)) {
				outer.push(event);
			}
		} catch (error) {
			const message = makeProviderLoadErrorMessage(model, error);
			outer.push({ type: "error", reason: "error", error: message });
			outer.end(message);
		}
	});
	return outer;
}

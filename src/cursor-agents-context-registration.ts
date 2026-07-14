import { isCursorModel } from "./cursor-model.js";
import { registerCursorModelLifecycle, type CursorModelLifecycleExtensionApi } from "./cursor-model-lifecycle.js";
import { resolveEffectiveCursorConfigForContext } from "./cursor-runtime-state.js";

export type CursorAgentsContextExtensionApi = CursorModelLifecycleExtensionApi;

export function registerCursorAgentsContextDedup(pi: CursorAgentsContextExtensionApi): void {
	registerCursorModelLifecycle(pi, {
		beforeAgentStart: async (event, ctx) => {
			if (!isCursorModel(ctx.model)) return undefined;
			const { resolveCursorFacingSystemPrompt } = await import("./cursor-agents-context.js");
			const runtime = resolveEffectiveCursorConfigForContext(ctx).runtime.value;
			const resolved = resolveCursorFacingSystemPrompt(
				event.systemPrompt,
				ctx.model,
				undefined,
				undefined,
				undefined,
				runtime,
			);
			const { joinSystemPromptText } = await import("./context.js");
			if (joinSystemPromptText(resolved) === joinSystemPromptText(event.systemPrompt)) return undefined;
			return { systemPrompt: resolved };
		},
	});
}

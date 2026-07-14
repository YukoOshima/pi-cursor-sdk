import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Model } from "@oh-my-pi/pi-ai";
import { CURSOR_PROVIDER, CURSOR_SDK_API } from "./cursor-model.js";
import { registerCursorModelLifecycle, type CursorModelLifecycleExtensionApi } from "./cursor-model-lifecycle.js";

const CURSOR_AGENT_API = "cursor-agent";
const EFFORT_SUFFIXES = new Set(["low", "medium", "high", "xhigh", "max"]);

export type CursorBuiltinModelRemapPlan = {
	candidates: string[];
	thinkingLevel?: string;
};

type CursorModelLike = Pick<Model, "id" | "provider" | "api">;

type CursorRemapModelRegistry = {
	find(provider: string, id: string): CursorModelLike | undefined;
	getAll(): CursorModelLike[];
};

type CursorRemapContext = {
	model?: CursorModelLike;
	modelRegistry: CursorRemapModelRegistry;
	setModel(model: Model): Promise<boolean>;
	setThinkingLevel?(level: string): void;
	hasUI?: boolean;
	ui?: Pick<ExtensionContext["ui"], "notify">;
};

export type CursorBuiltinModelRemapExtensionApi = CursorModelLifecycleExtensionApi &
	Pick<ExtensionAPI, "setModel" | "setThinkingLevel">;

/**
 * Map omp built-in Cursor Agent model ids onto pi-cursor-sdk catalog ids.
 *
 * Examples:
 * - `cursor-grok-4.5-high` → `grok-4.5` (thinking: high)
 * - `cursor-grok-4.5-high-fast` → `grok-4.5:fast`, then `grok-4.5` (thinking: high)
 */
export function mapBuiltinCursorModelIdToSdkPlan(modelId: string): CursorBuiltinModelRemapPlan {
	let rest = modelId.trim();
	if (!rest) return { candidates: [] };

	let preferFast = false;
	if (rest.endsWith("-fast")) {
		preferFast = true;
		rest = rest.slice(0, -"-fast".length);
	}

	let thinkingLevel: string | undefined;
	const effortSeparator = rest.lastIndexOf("-");
	if (effortSeparator > 0) {
		const maybeEffort = rest.slice(effortSeparator + 1);
		if (EFFORT_SUFFIXES.has(maybeEffort)) {
			thinkingLevel = maybeEffort;
			rest = rest.slice(0, effortSeparator);
		}
	}

	if (rest.startsWith("cursor-")) {
		rest = rest.slice("cursor-".length);
	}

	if (!rest) return { candidates: [] };

	const candidates: string[] = [];
	if (preferFast) candidates.push(`${rest}:fast`);
	candidates.push(rest);
	return thinkingLevel ? { candidates, thinkingLevel } : { candidates };
}

export function isStaleCursorBuiltinModel(
	model: CursorModelLike | undefined,
	registry: CursorRemapModelRegistry,
): boolean {
	if (!model || model.provider !== CURSOR_PROVIDER) return false;
	if (model.api === CURSOR_SDK_API) return false;
	if (model.api !== CURSOR_AGENT_API && model.api !== undefined) {
		// Unknown cursor transport; only remap the known built-in Agent API.
		return false;
	}
	const live = registry.find(CURSOR_PROVIDER, model.id);
	if (live?.api === CURSOR_SDK_API) return false;
	return registry.getAll().some((entry) => entry.provider === CURSOR_PROVIDER && entry.api === CURSOR_SDK_API);
}

export function resolveCursorSdkReplacement(
	model: CursorModelLike,
	registry: CursorRemapModelRegistry,
): { model: CursorModelLike; thinkingLevel?: string } | undefined {
	const plan = mapBuiltinCursorModelIdToSdkPlan(model.id);
	for (const candidateId of plan.candidates) {
		const candidate = registry.find(CURSOR_PROVIDER, candidateId);
		if (candidate?.api === CURSOR_SDK_API) {
			return plan.thinkingLevel
				? { model: candidate, thinkingLevel: plan.thinkingLevel }
				: { model: candidate };
		}
	}
	return undefined;
}

export async function rebaseStaleCursorBuiltinModel(ctx: CursorRemapContext): Promise<boolean> {
	const current = ctx.model;
	if (!isStaleCursorBuiltinModel(current, ctx.modelRegistry) || !current) return false;

	const replacement = resolveCursorSdkReplacement(current, ctx.modelRegistry);
	if (!replacement) return false;

	const switched = await ctx.setModel(replacement.model as Model);
	if (!switched) return false;

	if (replacement.thinkingLevel && typeof ctx.setThinkingLevel === "function") {
		try {
			ctx.setThinkingLevel(replacement.thinkingLevel);
		} catch {
			// Thinking restore is best-effort; model switch already fixed the transport.
		}
	}

	if (ctx.hasUI) {
		ctx.ui?.notify(
			`Cursor model rebound from built-in ${current.id} to SDK ${replacement.model.id} (omp resolved the built-in catalog before pi-cursor-sdk registered).`,
			"info",
		);
	}
	return true;
}

export function registerCursorBuiltinModelRemap(pi: CursorBuiltinModelRemapExtensionApi): void {
	registerCursorModelLifecycle(pi, {
		sync: async (ctx) => {
			await rebaseStaleCursorBuiltinModel({
				model: ctx.model as CursorModelLike | undefined,
				modelRegistry: ctx.modelRegistry as CursorRemapModelRegistry,
				setModel: (model) => pi.setModel(model),
				setThinkingLevel: (level) => {
					pi.setThinkingLevel(level as Parameters<ExtensionAPI["setThinkingLevel"]>[0]);
				},
				hasUI: ctx.hasUI,
				ui: ctx.ui,
			});
		},
	});
}

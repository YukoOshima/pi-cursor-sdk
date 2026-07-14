import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionContext,
	ExtensionHandler,
	SessionStartEvent,
	TurnStartEvent,
} from "@oh-my-pi/pi-coding-agent";

export type CursorModelLifecycleContext = ExtensionContext;

type CursorModelSelectEvent = { model: ExtensionContext["model"] };

type CursorModelLifecycleSyncHandler = (ctx: CursorModelLifecycleContext) => Promise<void> | void;
type CursorModelSessionStartHandler = ExtensionHandler<SessionStartEvent>;
type CursorModelSelectHandler = (event: CursorModelSelectEvent, ctx: CursorModelLifecycleContext) => Promise<void> | void;
type CursorModelTurnStartHandler = ExtensionHandler<TurnStartEvent>;
type CursorModelBeforeAgentStartHandler = ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>;

type LifecycleListener = (event: object, ctx: CursorModelLifecycleContext) => unknown;

export interface CursorModelLifecycleExtensionApi {
	// Loose `on` accepts ExtensionAPI-compatible registrars (omp may omit model_select).
	on(event: string, handler: LifecycleListener): void;
}

export interface CursorModelLifecycleHandlers {
	sessionStart?: CursorModelSessionStartHandler;
	modelSelect?: CursorModelSelectHandler;
	turnStart?: CursorModelTurnStartHandler;
	sync?: CursorModelLifecycleSyncHandler;
	beforeAgentStart?: CursorModelBeforeAgentStartHandler;
}

function normalizeLifecycleHandlers(
	handlerOrHandlers: CursorModelLifecycleSyncHandler | CursorModelLifecycleHandlers,
): CursorModelLifecycleHandlers {
	return typeof handlerOrHandlers === "function" ? { sync: handlerOrHandlers } : handlerOrHandlers;
}

export function registerCursorModelLifecycle(
	pi: CursorModelLifecycleExtensionApi,
	handlerOrHandlers: CursorModelLifecycleSyncHandler | CursorModelLifecycleHandlers,
): void {
	const handlers = normalizeLifecycleHandlers(handlerOrHandlers);
	const sync = handlers.sync;
	if (handlers.sessionStart || sync) {
		pi.on("session_start", async (event, ctx) => {
			await handlers.sessionStart?.(event as SessionStartEvent, ctx);
			await sync?.(ctx);
		});
	}
	if (handlers.modelSelect || sync) {
		pi.on("model_select", async (event, ctx) => {
			const selectEvent = event as CursorModelSelectEvent;
			const effectiveCtx = { ...ctx, model: selectEvent.model };
			await handlers.modelSelect?.(selectEvent, effectiveCtx);
			await sync?.(effectiveCtx);
		});
	}
	if (handlers.turnStart || sync) {
		pi.on("turn_start", async (event, ctx) => {
			await handlers.turnStart?.(event as TurnStartEvent, ctx);
			await sync?.(ctx);
		});
	}
	if (handlers.beforeAgentStart || sync) {
		pi.on("before_agent_start", async (event, ctx) => {
			await sync?.(ctx);
			return await handlers.beforeAgentStart?.(event as BeforeAgentStartEvent, ctx);
		});
	}
}

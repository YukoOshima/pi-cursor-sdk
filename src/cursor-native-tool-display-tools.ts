import { type ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "./host-tool-definitions.js";
import { Text } from "@oh-my-pi/pi-tui";
import { getCursorSessionCwd } from "./cursor-session-scope.js";
import {
	CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES,
	CURSOR_REPLAY_TOOL_NAMES,
	type BuiltinNativeCursorToolName,
	type NativeCursorToolName,
} from "./cursor-native-tool-names.js";
import { isCursorReplayToolName } from "./cursor-tool-presentation-registry.js";
import {
	createCursorReplayOnlyToolDefinition,
	isCursorReplayNativeEditDetails,
	isCursorReplayNativeWriteDetails,
	parseCursorReplayToolDetails,
	renderCursorReplayResult,
	renderNativeLookingCursorFileMutationCall,
	renderNativeLookingCursorReadReplayResult,
} from "./cursor-native-tool-display-replay.js";
import {
	consumeCursorNativeToolDisplay,
	isCursorReplayToolCallId,
} from "./cursor-native-tool-display-state.js";


/** Prefer `any` params to avoid typebox vs pi-ai TSchema mismatch under omp. */
type AnyToolDefinition = ToolDefinition<any, unknown>;
type RenderCall = NonNullable<AnyToolDefinition["renderCall"]>;
type RenderResult = NonNullable<AnyToolDefinition["renderResult"]>;

type NativeReplayStrategy = {
	createDefinition: (cwd: string) => AnyToolDefinition;
	missingReplayPolicy?: "block-file-mutation";
	renderReplayCall?: (
		args: Parameters<RenderCall>[0],
		options: Parameters<RenderCall>[1],
		theme: Parameters<RenderCall>[2],
		renderBase: () => ReturnType<RenderCall>,
	) => ReturnType<RenderCall>;
	renderReplayResult?: (
		result: Parameters<RenderResult>[0],
		options: Parameters<RenderResult>[1],
		theme: Parameters<RenderResult>[2],
		args: Parameters<RenderResult>[3],
		renderBase: () => ReturnType<RenderResult>,
	) => ReturnType<RenderResult>;
};

function emptyText(): Text {
	return new Text("", 0, 0);
}

function renderReadReplayCall(
	args: Parameters<RenderCall>[0],
	options: Parameters<RenderCall>[1],
	theme: Parameters<RenderCall>[2],
	renderBase: () => ReturnType<RenderCall>,
): ReturnType<RenderCall> {
	const rendered = renderBase();
	if ((args as Record<string, unknown>).localReadPreview !== true || options.expanded) return rendered;
	const baseText = rendered.render(120).join("\n").trimEnd();
	const labeled = `${baseText}${theme.fg("muted", " · local file preview")}`;
	if (rendered instanceof Text) {
		rendered.setText(labeled);
		return rendered;
	}
	return new Text(labeled, 0, 0);
}

function renderReadReplayResult(
	result: Parameters<RenderResult>[0],
	options: Parameters<RenderResult>[1],
	theme: Parameters<RenderResult>[2],
	args: Parameters<RenderResult>[3],
	renderBase: () => ReturnType<RenderResult>,
): ReturnType<RenderResult> {
	return renderNativeLookingCursorReadReplayResult(result, options, theme, args, renderBase);
}

function renderEditReplayResult(
	result: Parameters<RenderResult>[0],
	options: Parameters<RenderResult>[1],
	theme: Parameters<RenderResult>[2],
	args: Parameters<RenderResult>[3],
	renderBase: () => ReturnType<RenderResult>,
): ReturnType<RenderResult> {
	const details = parseCursorReplayToolDetails(result.details);
	return details && isCursorReplayNativeEditDetails(details)
		? renderCursorReplayResult(result, options, theme, Boolean(result.isError))
		: renderBase();
}

function renderWriteReplayResult(
	result: Parameters<RenderResult>[0],
	options: Parameters<RenderResult>[1],
	theme: Parameters<RenderResult>[2],
	args: Parameters<RenderResult>[3],
	renderBase: () => ReturnType<RenderResult>,
): ReturnType<RenderResult> {
	const details = parseCursorReplayToolDetails(result.details);
	return details && isCursorReplayNativeWriteDetails(details)
		? renderCursorReplayResult(result, options, theme, Boolean(result.isError))
		: renderBase();
}

const NATIVE_CURSOR_TOOL_STRATEGIES: Record<BuiltinNativeCursorToolName, NativeReplayStrategy> = {
	read: {
		createDefinition: (cwd) => createReadToolDefinition(cwd) as AnyToolDefinition,
		renderReplayCall: renderReadReplayCall,
		renderReplayResult: renderReadReplayResult,
	},
	bash: { createDefinition: (cwd) => createBashToolDefinition(cwd) as AnyToolDefinition },
	edit: {
		createDefinition: (cwd) => createEditToolDefinition(cwd) as AnyToolDefinition,
		missingReplayPolicy: "block-file-mutation",
		renderReplayCall: (args, options, theme, renderBase) =>
			options.isPartial
				? renderNativeLookingCursorFileMutationCall("edit", args as Record<string, unknown>, theme, true)
				: renderBase(),
		renderReplayResult: renderEditReplayResult,
	},
	write: {
		createDefinition: (cwd) => createWriteToolDefinition(cwd) as AnyToolDefinition,
		missingReplayPolicy: "block-file-mutation",
		renderReplayCall: (args, options, theme, renderBase) =>
			options.isPartial
				? renderNativeLookingCursorFileMutationCall("write", args as Record<string, unknown>, theme, true)
				: renderBase(),
		renderReplayResult: renderWriteReplayResult,
	},
	grep: { createDefinition: (cwd) => createGrepToolDefinition(cwd) as AnyToolDefinition },
	find: { createDefinition: (cwd) => createFindToolDefinition(cwd) as AnyToolDefinition },
	ls: { createDefinition: (cwd) => createLsToolDefinition(cwd) as AnyToolDefinition },
};


function getNativeReplayStrategy(toolName: string): NativeReplayStrategy | undefined {
	return Object.hasOwn(NATIVE_CURSOR_TOOL_STRATEGIES, toolName)
		? NATIVE_CURSOR_TOOL_STRATEGIES[toolName as BuiltinNativeCursorToolName]
		: undefined;
}


export function wrapNativeCursorTool(definition: AnyToolDefinition, getCurrentDefinition: () => AnyToolDefinition): AnyToolDefinition {
	const strategy = getNativeReplayStrategy(definition.name);
	return {
		...definition,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cursorDisplay = consumeCursorNativeToolDisplay(toolCallId);
			if (cursorDisplay) {
				if (cursorDisplay.isError) {
					const text = cursorDisplay.result.content
						.map((entry) => (entry.type === "text" ? entry.text : undefined))
						.filter((entry): entry is string => Boolean(entry))
						.join("\n");
					throw new Error(text || "Cursor tool replay failed");
				}
				return {
					content: cursorDisplay.result.content,
					details: cursorDisplay.result.details,
					terminate: cursorDisplay.terminate ?? true,
				};
			}
			if (strategy?.missingReplayPolicy === "block-file-mutation" && isCursorReplayToolCallId(toolCallId)) {
				throw new Error(`No recorded Cursor ${definition.name} result was available. This replay-only call does not execute file mutations.`);
			}
			return getCurrentDefinition().execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, options, theme) {
			const currentRenderCall = getCurrentDefinition().renderCall;
			const renderBase = () => currentRenderCall?.(args, options, theme) ?? emptyText();
			if (strategy?.renderReplayCall) {
				return strategy.renderReplayCall(args, options, theme, renderBase);
			}
			return renderBase();
		},
		renderResult(result, options, theme, args) {
			const currentRenderResult = getCurrentDefinition().renderResult;
			const renderBase = () => currentRenderResult?.(result, options, theme, args) ?? emptyText();
			if (strategy?.renderReplayResult) {
				return strategy.renderReplayResult(result, options, theme, args, renderBase);
			}
			return renderBase();
		},
	};
}

export function createNativeCursorToolDefinition(toolName: NativeCursorToolName, cwd: string): AnyToolDefinition {
	const strategy = getNativeReplayStrategy(toolName);
	if (strategy) return strategy.createDefinition(cwd);
	if (isCursorReplayToolName(toolName)) return createCursorReplayOnlyToolDefinition(toolName);
	throw new Error(`Unsupported Cursor native replay tool: ${toolName}`);
}

export function registerNativeCursorTool(
	pi: Pick<import("@oh-my-pi/pi-coding-agent").ExtensionAPI, "registerTool">,
	toolName: NativeCursorToolName,
): void {
	const definition = createNativeCursorToolDefinition(toolName, getCursorSessionCwd());
	pi.registerTool(wrapNativeCursorTool(definition, () => createNativeCursorToolDefinition(toolName, getCursorSessionCwd())));
}

export { CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES, CURSOR_REPLAY_TOOL_NAMES };

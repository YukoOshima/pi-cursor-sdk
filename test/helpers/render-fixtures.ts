import type { RegisteredTool } from "./pi-harness-types.js";

type ToolRenderCall = NonNullable<RegisteredTool["renderCall"]>;
type ToolRenderResult = NonNullable<RegisteredTool["renderResult"]>;

/** renderCall(args, options, theme) / renderResult(result, options, theme, args?) */
export type HarnessRenderArgs = Parameters<ToolRenderCall>[0];
export type HarnessRenderResultOptions = Parameters<ToolRenderCall>[1];
export type HarnessRenderTheme = Parameters<ToolRenderCall>[2];

export function createRenderTheme(overrides: Record<string, unknown> = {}): HarnessRenderTheme {
	return {
		fg: (_style: string, text: string) => text,
		bold: (text: string) => text,
		...overrides,
	} as HarnessRenderTheme;
}

export function createRenderOptions(overrides: Record<string, unknown> = {}): HarnessRenderResultOptions {
	return {
		expanded: false,
		isPartial: false,
		...overrides,
	} as HarnessRenderResultOptions;
}

/** Transitional helper for renderCall/renderResult tests; accepts legacy fields. */
export function createRenderContext(overrides: Record<string, unknown> = {}): any {
	return {
		expanded: false,
		isPartial: false,
		args: {},
		...overrides,
	};
}

import type { CursorSdkModule } from "./cursor-sdk-types.js";

export type { CursorSdkModule };

let cursorSdkModuleOverride: CursorSdkModule | Promise<CursorSdkModule> | undefined;

/**
 * Test-only seam: vitest `vi.mock("@cursor/sdk")` does not intercept the
 * runtime-built dynamic import below (required to keep the SDK off omp's
 * extension rewrite graph). Tests that mock `@cursor/sdk` must also call this.
 */
export function setCursorSdkModuleForTests(module?: CursorSdkModule | Promise<CursorSdkModule>): void {
	cursorSdkModuleOverride = module;
}

/**
 * Load `@cursor/sdk` without a static bare specifier string.
 *
 * omp's extension graph collector scrapes `import("@cursor/sdk")` / `from "@cursor/sdk"`
 * out of raw TypeScript and installs Bun onLoad rewrite hooks on the SDK webpack
 * entry. Those hooks break async chunk installation (`__webpack_esm_ids__` /
 * `r.length`). Building the specifier at runtime keeps the SDK off that graph.
 */
export async function loadCursorSdk(): Promise<CursorSdkModule> {
	if (cursorSdkModuleOverride !== undefined) {
		return cursorSdkModuleOverride;
	}
	const specifier = "@cursor/" + "sdk";
	return import(specifier) as Promise<CursorSdkModule>;
}

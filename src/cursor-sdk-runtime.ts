import type { CursorSdkModule } from "./cursor-sdk-types.js";

export type { CursorSdkModule };

/**
 * Load `@cursor/sdk` without a static bare specifier string.
 *
 * omp's extension graph collector scrapes `import("@cursor/sdk")` / `from "@cursor/sdk"`
 * out of raw TypeScript and installs Bun onLoad rewrite hooks on the SDK webpack
 * entry. Those hooks break async chunk installation (`__webpack_esm_ids__` /
 * `r.length`). Building the specifier at runtime keeps the SDK off that graph.
 */
export async function loadCursorSdk(): Promise<CursorSdkModule> {
	const specifier = "@cursor/" + "sdk";
	return import(specifier) as Promise<CursorSdkModule>;
}

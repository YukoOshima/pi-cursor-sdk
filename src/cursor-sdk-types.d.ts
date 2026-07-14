/**
 * Type-only surface for `@cursor/sdk`.
 *
 * Kept as a `.d.ts` so omp's extension graph walker never loads the SDK's
 * webpack `index.js` through its rewrite hooks (type-only `from "@cursor/sdk"`
 * in `.ts` sources is still scraped as a bare dependency and breaks Agent.create).
 */
export type * from "@cursor/sdk";
import type * as CursorSdkNamespace from "@cursor/sdk";
export type CursorSdkModule = typeof CursorSdkNamespace;

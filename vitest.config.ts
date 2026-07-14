import { defineConfig } from "vitest/config";

/**
 * omp packages (`@oh-my-pi/*`) require Bun (`import.meta.dir`, `Bun.env`, native addons).
 * Externalize them so Vite/Rolldown does not rewrite their sources, and run vitest under Bun:
 *   bun --bun vitest run
 */
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		exclude: ["test/**/*.compile.test.ts"],
		server: {
			deps: {
				external: [/^@oh-my-pi\//, /node_modules\/@oh-my-pi\//],
			},
		},
	},
	ssr: {
		external: [/^@oh-my-pi\//],
	},
});

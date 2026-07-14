import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FALLBACK_MODEL_ITEMS } from "../src/cursor-fallback-models.generated.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as {
	version: string;
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
	peerDependencies: Record<string, string>;
	bundledDependencies?: string[];
	overrides?: Record<string, string>;
	omp?: { extensions?: string[] };
	pi?: { extensions?: string[] };
};
const packageLock = require("../package-lock.json") as {
	version: string;
	packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};

const PI_PACKAGES = [
	"@oh-my-pi/pi-ai",
	"@oh-my-pi/pi-coding-agent",
	"@oh-my-pi/pi-tui",
	"@oh-my-pi/pi-utils",
] as const;

function lockPackageVersion(packageName: string): string | undefined {
	return packageLock.packages[`node_modules/${packageName}`]?.version;
}

describe("package metadata cutover baselines", () => {
	it("keeps package, lockfile, and changelog release versions aligned", () => {
		const changelogVersion = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8").match(/^## (\S+) /m)?.[1];

		expect(packageLock.version).toBe(packageJson.version);
		expect(packageLock.packages[""]?.version).toBe(packageJson.version);
		expect(changelogVersion).toBe(packageJson.version);
	});

	it("pins Cursor SDK exactly", () => {
		expect(packageJson.dependencies["@cursor/sdk"]).toBe("1.0.23");
		expect(lockPackageVersion("@cursor/sdk")).toBe("1.0.23");
	});

	it("keeps local agent ID policy aligned with the installed public string contract", () => {
		const sdkOptions = readFileSync(join(process.cwd(), "node_modules/@cursor/sdk/dist/esm/options.d.ts"), "utf8");

		expect(sdkOptions).toMatch(/export interface AgentOptions[\s\S]*?\bagentId\?: string;/);
	});

	it("pins the Node ConnectRPC transport required by Cursor SDK's Node seam", () => {
		const sdkTransportDts = readFileSync(
			join(process.cwd(), "node_modules/@cursor/sdk/dist/esm/transport.d.ts"),
			"utf8",
		);

		expect(sdkTransportDts).toContain("Node");
		expect(sdkTransportDts).toContain("`@connectrpc/connect-node`");
		expect(packageLock.packages["node_modules/@cursor/sdk"]?.dependencies?.["@connectrpc/connect-node"]).toBe("^1.6.1");
		expect(packageJson.dependencies["@connectrpc/connect-node"]).toBeUndefined();
		expect(lockPackageVersion("@connectrpc/connect-node")).toBe("1.7.0");
	});

	it("keeps installed ConnectRPC transport siblings aligned", () => {
		expect(lockPackageVersion("@connectrpc/connect-node")).toBe("1.7.0");
		expect(lockPackageVersion("@connectrpc/connect-web")).toBe("1.7.0");
	});

	it("leaves the Cursor SDK transport dependency tree to npm resolution", () => {
		expect(packageJson.dependencies.undici).toBeUndefined();
		expect(packageJson.bundledDependencies).toBeUndefined();
		// bnpm linkedom ceiling is 0.18.12; pin via overrides for @oh-my-pi installs
		expect(packageJson.overrides).toEqual({ linkedom: "0.18.12" });
		expect(packageLock.packages["node_modules/@connectrpc/connect-node/node_modules/undici"]?.version).toBe("5.29.0");
	});

	it("removes the obsolete sqlite override", () => {
		expect(packageJson.overrides?.sqlite3).toBeUndefined();
	});

	it("pins omp validation baselines", () => {
		for (const packageName of PI_PACKAGES) {
			expect(packageJson.devDependencies[packageName]).toBe("16.5.0");
			expect(lockPackageVersion(packageName)).toBe("16.5.0");
		}
	});

	it("declares omp.extensions for the provider entrypoint", () => {
		expect(packageJson.omp?.extensions).toEqual(["./src/index.ts"]);
		// Benign mirror for omp's omp||pi manifest reader; docs/install remain omp-first.
		expect(packageJson.pi?.extensions).toEqual(["./src/index.ts"]);
	});

	it("resolves @oh-my-pi/pi-ai package root for omp", () => {
		const aiPkgPath = join(process.cwd(), "node_modules/@oh-my-pi/pi-ai/package.json");
		const aiPkg = JSON.parse(readFileSync(aiPkgPath, "utf8")) as { name: string; version: string };
		expect(aiPkg.name).toBe("@oh-my-pi/pi-ai");
		expect(aiPkg.version).toBe("16.5.0");
		expect(lockPackageVersion("@oh-my-pi/pi-ai")).toBe("16.5.0");
	});

	it("keeps Grok UX examples aligned with the generated Cursor catalog", () => {
		const spec = readFileSync(join(process.cwd(), "docs/cursor-model-ux-spec.md"), "utf8");
		const grok = FALLBACK_MODEL_ITEMS.find((item) => item.id === "grok-4.5");

		expect(grok?.parameters?.map((parameter) => parameter.id)).toEqual(["effort", "fast"]);
		expect(FALLBACK_MODEL_ITEMS.some((item) => item.id === "grok-4.3")).toBe(false);
		expect(spec).toContain("### `grok-4.5`");
		expect(spec).not.toContain("grok-4.3");
	});

	it("keeps @oh-my-pi peer dependency ranges unpinned per omp package guidance", () => {
		for (const packageName of PI_PACKAGES) {
			expect(packageJson.peerDependencies[packageName]).toBe("*");
		}
	});
});

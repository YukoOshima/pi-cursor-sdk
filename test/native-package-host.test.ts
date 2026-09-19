import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = process.cwd();
const host = resolve("node_modules/@earendil-works/pi-coding-agent");
const probe = resolve("scripts/check-pi-host-runtime.mjs");
const osKeys = new Set(["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TMPDIR", "TMP", "TEMP"]);

function isolatedEnv(root: string): NodeJS.ProcessEnv {
	return {
		...Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toUpperCase()))),
		PATH: `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
		HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: join(root, "agent"),
		PI_OFFLINE: "1", PI_TELEMETRY: "0", npm_config_ignore_scripts: "true",
	};
}

function run(command: string, args: string[], cwd: string, env = process.env): string {
	const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 180_000, maxBuffer: 10 * 1024 * 1024, shell: process.platform === "win32" && command === "npm" });
	expect(result.error).toBeUndefined();
	expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
	return result.stdout;
}

function npm(args: string[], cwd: string): string {
	return process.env.npm_execpath
		? run(process.execPath, [process.env.npm_execpath, ...args], cwd)
		: run("npm", args, cwd);
}

describe("packed manifest through native Pi (no extension import hooks)", () => {
	let root: string;
	let tarball: string;
	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "cursor-native-package-"));
		// The regular pack lifecycle builds dist; the installed package, not this
		// checkout, supplies every runtime module exercised by the probe.
		const packed = JSON.parse(npm(["pack", "--json", "--pack-destination", root], repo)) as Array<{ filename: string }>;
		tarball = join(root, packed[0].filename);
	}, 180_000);
	afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); }, 120_000);

	it.each(["0.84.0", "0.85.1"])("keeps host identity and replay with co-installed %s peers", (version) => {
		const layout = join(root, `peers-${version}`);
		mkdirSync(layout);
		writeFileSync(join(layout, "package.json"), JSON.stringify({
			name: "native-package-peer-fixture", private: true, dependencies: {
				"pi-cursor-sdk": `file:${tarball}`,
				"@earendil-works/pi-ai": version,
				"@earendil-works/pi-coding-agent": version,
				"@earendil-works/pi-tui": version,
			},
		}));
		npm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], layout);
		const installed = join(layout, "node_modules/pi-cursor-sdk");
		const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as { pi: { extensions: string[] } };
		expect(manifest.pi.extensions).toEqual(["./src/index.ts"]);
		expect(existsSync(join(installed, "dist/index.js"))).toBe(true);
		const peerPath = join(layout, "node_modules/@earendil-works/pi-ai/package.json");
		const peerBefore = readFileSync(peerPath, "utf8");
		expect(JSON.parse(peerBefore).version).toBe(version);
		// Pi 0.84 ships only dist/cli.js; newer hosts also ship the bundle.
		for (const mode of ["sdk", "modular", ...(existsSync(join(host, "dist/bundle/cli.js")) ? ["bundled"] : [])]) {
			const output = run(process.execPath, [probe, host, installed, ...(mode === "sdk" ? [] : [`--cli=${mode}`])], repo, isolatedEnv(join(root, `home-${version}-${mode}`)));
			const result = JSON.parse(output) as { entrypoint: string; streamIdentity: boolean; registeredStreamIdentity?: boolean; replayEmission: { final: string }; cursorRegistered: boolean; forkCheckpointsRequired: boolean; legacyReplacement?: unknown };
			expect(result.entrypoint).toBe(join(realpathSync(installed), "src/index.ts"));
			expect(result.cursorRegistered).toBe(true);
			expect(result.streamIdentity).toBe(true);
			if (mode === "sdk") expect(result.registeredStreamIdentity).toBe(true);
			expect(result.replayEmission.final).toBe("stop");
			expect(result.forkCheckpointsRequired).toBe(false);
			expect(result.legacyReplacement).toBeUndefined();
		}
		expect(readFileSync(peerPath, "utf8")).toBe(peerBefore);
	}, 240_000);

	it("rejects explicit fork qualification on a stock host without transcript helpers", () => {
		for (const mode of ["sdk", "modular"]) {
			const out = join(root, `fork-qualification-${mode}`);
			const result = spawnSync(process.execPath, [probe, host, repo, `--out=${out}`, "--verify-fork-checkpoints", ...(mode === "sdk" ? [] : [`--cli=${mode}`])], {
				cwd: repo, env: isolatedEnv(out), encoding: "utf8", timeout: 90_000,
			});
			expect(result.error).toBeUndefined();
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("fork checkpoint qualification requires host SystemMessage.replace replay");
			const report = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
			expect(report.transcript).toBe(false);
			expect(report.forkCheckpointsRequired).toBe(true);
			expect(report.legacyReplacement).toBeUndefined();
			expect(report.replayEmission.final).toBe("stop");
		}
	}, 180_000);

	it("loads a clean native managed tarball install without copying the development manifest", () => {
		const home = join(root, "managed");
		mkdirSync(home);
		const shippedCli = existsSync(join(host, "dist/bundle/cli.js")) ? "bundled" : "modular";
		run(process.execPath, [join(host, shippedCli === "bundled" ? "dist/bundle/cli.js" : "dist/cli.js"), "install", `npm:pi-cursor-sdk@file:${tarball}`], home, isolatedEnv(home));
		const installed = join(home, "agent/npm/node_modules/pi-cursor-sdk");
		expect(existsSync(join(home, "agent/npm/node_modules/@earendil-works/pi-ai"))).toBe(false);
		const result = JSON.parse(run(process.execPath, [probe, host, installed, `--cli=${shippedCli}`], repo, isolatedEnv(home))) as { streamIdentity: boolean; cursorRegistered: boolean };
		expect(result.streamIdentity).toBe(true);
		expect(result.cursorRegistered).toBe(true);
	}, 240_000);
});

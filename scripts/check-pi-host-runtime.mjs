// Offline native package contract. No import hooks, peer aliases, or Cursor calls.
// Usage: node scripts/check-pi-host-runtime.mjs HOST [PACKAGE] [--cli=bundled|modular]
//        [--out=DIR] [--verify-fork-checkpoints]
// Common extension behavior is required on every host; the optional flag also
// qualifies the fork's host-native legacy SystemMessage.replace checkpoints.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPiHostRuntimeProbe } from "./lib/pi-host-runtime-probe.mjs";

const args = process.argv.slice(2);
const positional = args.filter(arg => !arg.startsWith("--"));
assert(positional.length >= 1 && positional.length <= 2, "Expected HOST [PACKAGE]");
for (const arg of args.filter(arg => arg.startsWith("--"))) {
	assert(/^--(?:cli=(?:bundled|modular)|out=.+|verify-fork-checkpoints)$/.test(arg), `Unknown option: ${arg}`);
}
const host = realpathSync(resolve(positional[0]));
// Match the native loader's resolved files when temp roots have OS aliases
// (e.g. macOS /var -> /private/var); do not create a second module identity.
const repo = realpathSync(positional[1] ? resolve(positional[1]) : fileURLToPath(new URL("../", import.meta.url)));
const cliMode = args.find(arg => arg.startsWith("--cli="))?.slice(6);
const output = args.find(arg => arg.startsWith("--out="))?.slice(6);
const outputRoot = output ? resolve(output) : mkdtempSync(join(tmpdir(), "cursor-host-compat-"));
mkdirSync(outputRoot, { recursive: true });
const root = realpathSync(outputRoot);
const verifyForkCheckpoints = args.includes("--verify-fork-checkpoints");
const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
assert.deepEqual(manifest.pi.extensions.length, 1);
const entrypoint = resolve(repo, manifest.pi.extensions[0]);
assert(existsSync(entrypoint), `Missing shipped manifest entry: ${entrypoint}`);
const envKeys = new Set(["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TMPDIR", "TMP", "TEMP", "JITI_DEBUG"]);
// Remove ambient credentials/settings before importing either host or package.
for (const key of Object.keys(process.env)) if (!envKeys.has(key.toUpperCase())) delete process.env[key];
Object.assign(process.env, {
	HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: join(root, "config"),
	PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1", PI_TELEMETRY: "0",
	PI_CURSOR_SETTING_SOURCES: "none", PI_CURSOR_RUNTIME: "local",
});
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
const resultPath = join(root, "result.json");
assert(!existsSync(resultPath) && !existsSync(resultPath + ".error"), "Use a fresh output directory; existing receipts are not overwritten");
const wrapper = join(root, "native-package-probe.ts");
writeFileSync(wrapper, createPiHostRuntimeProbe(entrypoint, resultPath, verifyForkCheckpoints));
let session;
try {
	if (cliMode) {
		const cli = join(host, cliMode === "bundled" ? "dist/bundle/cli.js" : "dist/cli.js");
		const cliArgs = [cli, "--approve", "--print", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "-e", repo, "-e", wrapper, "/check-native-package"];
		const child = spawnSync(process.execPath, cliArgs, { cwd: root, env: process.env, encoding: "utf8", timeout: 90_000, maxBuffer: 10 * 1024 * 1024 });
		writeFileSync(join(root, "launch.json"), JSON.stringify({ node: process.execPath, args: cliArgs, cwd: root, status: child.status }, null, 2));
		writeFileSync(join(root, "stdout.log"), child.stdout ?? "");
		writeFileSync(join(root, "stderr.log"), child.stderr ?? "");
		assert.ifError(child.error);
		assert.equal(child.status, 0, child.stderr);
		assert(!existsSync(resultPath + ".error"), existsSync(resultPath + ".error") ? readFileSync(resultPath + ".error", "utf8") : "");
		assert(existsSync(resultPath), `Native command did not complete: ${child.stderr}`);
	} else {
		const require = createRequire(join(host, "package.json"));
		const aiRoot = require.resolve.paths("@earendil-works/pi-ai").map(p => join(p, "@earendil-works/pi-ai")).find(p => existsSync(join(p, "package.json")));
		assert(aiRoot, "Host pi-ai dependency not found");
		const sdk = await import(pathToFileURL(join(host, "dist/index.js")));
		const ai = await import(pathToFileURL(realpathSync(join(aiRoot, "dist/index.js"))));
		const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
		const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalExtensionPaths: [repo, wrapper] });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert(loader.getExtensions().extensions.some(e => e.resolvedPath === entrypoint));
		const registration = loader.getExtensions().runtime.pendingProviderRegistrations.find(p => p.name === "cursor");
		assert(registration, "Manifest entry did not register Cursor");
		// Exercise the actual registered callback too, not only the supplemental
		// module probe. No API key means execution stops before SDK create/send.
		const registeredStream = registration.config.streamSimple({ ...registration.config.models[0], api: "cursor-sdk", provider: "cursor" }, { messages: [] });
		assert(registeredStream instanceof ai.AssistantMessageEventStream, "Registered provider uses a foreign pi-ai stream class");
		const preflight = await registeredStream.result();
		assert.equal(preflight.stopReason, "error");
		assert.match(preflight.errorMessage, /require a Cursor SDK API key/);
		const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
		({ session } = await sdk.createAgentSession({ cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, modelRuntime, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(root), settingsManager, tools: [] }));
		const runner = session.extensionRunner;
		const result = await runner.getToolDefinition("check_native_package").execute("probe", {}, undefined, undefined, runner.createContext());
		writeFileSync(resultPath, JSON.stringify({ ...result.details, registeredStreamIdentity: true }, null, 2));
		if (verifyForkCheckpoints) assert.equal(result.details.legacyReplacement?.pass, true, "fork checkpoint qualification requires host SystemMessage.replace replay");
	}
	console.log(JSON.stringify({ host, mode: cliMode ?? "sdk", ...JSON.parse(readFileSync(resultPath, "utf8")) }, null, 2));
} finally {
	if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
	if (!output) rmSync(root, { recursive: true, force: true });
}

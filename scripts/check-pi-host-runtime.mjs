// Native host loader and host-owned context replay; no Cursor/provider network calls.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Socket } from "node:net";

const host = resolve(process.argv[2]);
const repo = process.argv[3] ? resolve(process.argv[3]) : fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(join(host, "package.json"));
const aiRoot = require.resolve.paths("@earendil-works/pi-ai").map(p => join(p, "@earendil-works/pi-ai")).find(p => existsSync(join(p, "package.json")));
const aiPath = realpathSync(join(aiRoot, "dist/index.js"));
const root = mkdtempSync(join(tmpdir(), "cursor-host-compat-"));
process.env.HOME = root;
process.env.XDG_CONFIG_HOME = join(root, "config");
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_PACKAGE_DIR = host;
process.env.PI_OFFLINE = "1";
mkdirSync(process.env.PI_CODING_AGENT_DIR);
Socket.prototype.connect = function () { throw new Error("Network forbidden in compatibility test"); };
let blockedFetches = 0;
globalThis.fetch = async () => { blockedFetches++; throw new Error("Network forbidden in compatibility test"); };
const sdk = await import(pathToFileURL(join(host, "dist/index.js")));
const ai = await import(pathToFileURL(aiPath));
const transcript = typeof ai.getCurrentSystemPrompt === "function";
const wrapper = join(root, "cursor-context.ts");
writeFileSync(wrapper, `import {resolveCursorPiContext} from ${JSON.stringify(join(repo, "dist/cursor-pi-context.js"))};
export default function(pi) { pi.registerTool({name:"check_context",label:"check",description:"check",parameters:{type:"object",properties:{}},async execute(id,args) { return {content:[],details:resolveCursorPiContext(args.context)}; }}); }`);
const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalExtensionPaths: [repo, wrapper] });
let session;
try {
 await loader.reload();
 assert.deepEqual(loader.getExtensions().errors, []);
 assert(loader.getExtensions().extensions.some(e => e.resolvedPath === join(repo, "dist/index.js")));
 assert(loader.getExtensions().runtime.pendingProviderRegistrations.some(p => p.name === "cursor"));
 const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
 ({ session } = await sdk.createAgentSession({ cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, modelRuntime, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(root), settingsManager, tools: [] }));
 const runner = session.extensionRunner;
 const tool = name => ({ name, description: name, parameters: { type: "object", properties: {} } });
 const contexts = transcript ? [
  { messages: [
   { role: "system", content: "BASE", sections: { preamble: "OLD", custom: "STALE" }, toolsAdded: [tool("old")], timestamp: 1 },
   { role: "system", content: "", sections: { preamble: "NEW", custom: null }, toolsRemoved: [{ name: "old" }], toolsAdded: [tool("new")], timestamp: 2 },
  ] },
  { messages: [
   { role: "system", content: "OLD_BASE", sections: { preamble: "OLD", custom: "STALE" }, toolsAdded: [tool("old")], timestamp: 1 },
   { role: "system", content: "", replace: true, sections: { preamble: "NEW" }, toolsAdded: [tool("new")], timestamp: 2 },
  ] },
 ] : [{ systemPrompt: "NEW", tools: [tool("new")], messages: [] }];
 for (const context of contexts) {
  const result = await runner.getToolDefinition("check_context").execute("context", { context }, undefined, undefined, runner.createContext());
  assert.match(result.details.systemPrompt, /NEW/);
  assert.doesNotMatch(result.details.systemPrompt, /OLD|STALE/);
  assert.deepEqual(result.details.tools.map(t => t.name), ["new"]);
 }
 console.log(JSON.stringify({ host, aiPath, transcript, compiledEntrypoint: join(repo, "dist/index.js"), replayCases: contexts.length, cursorRegistered: true, blockedFetches, networkRequestsSent: 0 }, null, 2));
} finally {
 if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
 rmSync(root, { recursive: true, force: true });
}

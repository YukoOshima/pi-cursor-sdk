// Test extension source: imports the tested package graph without resolver hooks.
import { dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";

export function createPiHostRuntimeProbe(entrypoint, resultPath, verifyForkCheckpoints = false) {
	const moduleUrl = (name) => JSON.stringify(pathToFileURL(join(dirname(entrypoint), `${name}${extname(entrypoint)}`)).href);
	return `
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as ai from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveCursorPiContext } from ${moduleUrl("cursor-pi-context")};
import { streamCursorLazy } from ${moduleUrl("cursor-provider-lazy")};
import { cursorLiveRuns, createCursorNativeReplayId } from ${moduleUrl("cursor-provider-live-run-drain")};
import { registeredNativeToolNames } from ${moduleUrl("cursor-native-tool-display-state")};
import { createNativeCursorToolDefinition, wrapNativeCursorTool } from ${moduleUrl("cursor-native-tool-display-tools")};
import { CursorPiToolBridgeRegistry } from ${moduleUrl("cursor-pi-tool-bridge-server")};
import { loadCursorSdk } from ${moduleUrl("cursor-sdk-runtime")};
import { resolveBundledCursorRipgrepPath } from ${moduleUrl("cursor-ripgrep-path")};
import { getCursorSessionStoreIdentities, openCursorSessionStore } from ${moduleUrl("cursor-session-store")};

const tool = name => ({name, description:name, parameters:{type:"object",properties:{}}});
const transcript = typeof ai.getCurrentSystemPrompt === "function";
const model = {id:"offline-probe",name:"offline-probe",api:"cursor-sdk",provider:"cursor",baseUrl:"https://invalid.invalid",reasoning:false,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:4096};

async function check(ctx) {
 const report = {entrypoint:${JSON.stringify(entrypoint)}, transcript, forkCheckpointsRequired:${verifyForkCheckpoints}, sessionIdentity:ctx.sessionManager instanceof SessionManager};
 assert.equal(report.sessionIdentity, true);
 assert(ctx.modelRegistry.find("cursor","grok-4.6"),"manifest entry must register the Cursor provider");
 report.cursorRegistered = true;
 const context = transcript ? {messages:[
  {role:"system",content:"BASE",sections:{preamble:"OLD",custom:"STALE"},toolsAdded:[tool("old")],timestamp:1},
  {role:"system",content:"",sections:{preamble:"NEW",custom:null},toolsRemoved:[{name:"old"}],toolsAdded:[tool("read")],timestamp:2}
 ]} : {systemPrompt:"BASE\\n\\nNEW",tools:[tool("read")],messages:[]};
 const resolved = resolveCursorPiContext(context);
 assert.equal(resolved.systemPrompt,"BASE\\n\\nNEW");
 assert.deepEqual(resolved.tools.map(t=>t.name),["read"]);
 report.ordinaryReplay = resolved;
 // Fork-host qualification only: current official Pi removed SystemMessage.replace.
 // This synthetic legacy checkpoint is not part of the common extension contract.
 if (${verifyForkCheckpoints} && transcript) {
  const legacy = resolveCursorPiContext({messages:[
   {role:"system",content:"OLD_BASE",sections:{preamble:"OLD",custom:"STALE"},toolsAdded:[tool("old")],timestamp:1},
   {role:"system",content:"",replace:true,sections:{preamble:"NEW"},toolsAdded:[tool("read")],timestamp:2}
  ]});
  report.legacyReplacement = {result:legacy,pass:legacy.systemPrompt === "NEW" && legacy.tools.length === 1 && legacy.tools[0].name === "read"};
 }
 const replayId = createCursorNativeReplayId();
 const callId = replayId + "-tool-1";
 // Recorded SDK completion fixture, not a fabricated provider or Pi replay implementation.
 const recorded = {id:callId,toolName:"read",args:{path:"absent-native-probe.txt"},result:{content:[{type:"text",text:"RECORDED_NATIVE_RESULT"}],details:{}},isError:false};
 const wasRegistered = registeredNativeToolNames.has("read");
 registeredNativeToolNames.add("read");
 const run = cursorLiveRuns.start({id:replayId,agent:{},promptInputTokens:1});
 try {
  cursorLiveRuns.queueEvent(run,{type:"tool",tool:recorded});
  cursorLiveRuns.markFinished(run,"OFFLINE_DRAIN_OK");
  const stream = streamCursorLazy(model,context);
  report.streamIdentity = stream instanceof ai.AssistantMessageEventStream;
  assert.equal(report.streamIdentity,true,"provider stream must use the host pi-ai class");
  const events=[]; for await (const event of stream) events.push(event);
  const first=await stream.result();
  assert.equal(first.stopReason,"toolUse",first.errorMessage);
  const call=first.content.find(block=>block.type === "toolCall");
  assert.deepEqual({id:call.id,name:call.name,arguments:call.arguments},{id:callId,name:"read",arguments:recorded.args});
  assert(events.some(event=>event.type === "toolcall_end"));
  const definition=createNativeCursorToolDefinition("read",ctx.cwd);
  const wrapped=wrapNativeCursorTool(definition,()=>{throw new Error("Replay must not read the absent file");});
  const result=await wrapped.execute(callId,call.arguments,undefined,undefined,ctx);
  assert.deepEqual(result.content,recorded.result.content);
  const toolResult={role:"toolResult",toolCallId:callId,toolName:"read",content:result.content,isError:false,timestamp:3};
  const final=await streamCursorLazy(model,{...context,messages:[...context.messages,first,toolResult]}).result();
  assert.equal(final.stopReason,"stop",final.errorMessage);
  assert(final.content.some(block=>block.type === "text" && block.text === "OFFLINE_DRAIN_OK"));
  report.replayEmission={call,result,final:final.stopReason};
 } finally {
  await cursorLiveRuns.release(run);
  if (!wasRegistered) registeredNativeToolNames.delete("read");
 }
 // Exercise real dynamic import of the bridge implementation without listening
 // or contacting any service. SDK import is lazy and does not create an agent.
 const bridge=new CursorPiToolBridgeRegistry({getActiveTools:()=>[],getAllTools:()=>[]});
 const bridgeRun=await bridge.createRun();
 await bridgeRun.dispose(); await bridge.disposeAll();
 const sdk=await loadCursorSdk();
 assert.equal(typeof sdk.Agent.create,"function");
 assert.equal(typeof sdk.Agent.resume,"function");
 const identities=await getCursorSessionStoreIdentities(ctx.cwd,"native-host-probe",true);
 const store=await openCursorSessionStore(ctx.cwd,identities.sessionStore);
 await store.dispose();
 report.lazyModules={bridge:true,sdk:true,sqlite:true,ripgrep:resolveBundledCursorRipgrepPath()};
 assert.equal(typeof report.lazyModules.ripgrep,"string");
 return report;
}
export default function(pi) {
 const execute=async (_id,_args,_signal,_update,ctx)=>({content:[],details:await check(ctx)});
 pi.registerTool({name:"check_native_package",label:"check",description:"offline packed-host contract",parameters:{type:"object",properties:{}},execute});
 pi.registerCommand("check-native-package",{handler:async (_args,ctx)=>{
  try {
   const report=await check(ctx);
   writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(report,null,2));
   if (${verifyForkCheckpoints}) assert.equal(report.legacyReplacement?.pass,true,"fork checkpoint qualification requires host SystemMessage.replace replay");
  } catch(error) {
   writeFileSync(${JSON.stringify(resultPath + ".error")},String(error.stack ?? error));
   throw error;
  }
 }});
}
`;
}

import { afterEach, describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { createEventHarness } from "./helpers/pi-harness.js";
import {
	CURSOR_TEAMMATE_CHILD_TOOL_NAMES,
	PI_MAESTRO_TEAMMATE_CHILD_EXTENSIONS_KEY,
	registerCursorSdkTeammateChildExtension,
	registerCursorTeammateChildExtensionLifecycle,
	__testUtils as teammateChildExtensionTestUtils,
} from "../src/cursor-teammate-child-extension.js";
import { CURSOR_ASK_QUESTION_TOOL_NAME } from "../src/cursor-question-tool.js";
import { CURSOR_ACTIVATE_SKILL_TOOL_NAME } from "../src/cursor-skill-tool.js";

interface FakeRegistry {
	registrations: Map<symbol, { path: string; tools: readonly string[] }>;
}

function installFakeRegistry(): FakeRegistry {
	const registry: FakeRegistry = { registrations: new Map() };
	const globals = globalThis as typeof globalThis & Record<symbol, unknown>;
	globals[PI_MAESTRO_TEAMMATE_CHILD_EXTENSIONS_KEY] = registry;
	return registry;
}

function clearFakeRegistry(): void {
	const globals = globalThis as typeof globalThis & Record<symbol, unknown>;
	delete globals[PI_MAESTRO_TEAMMATE_CHILD_EXTENSIONS_KEY];
}

afterEach(() => {
	clearFakeRegistry();
});

describe("cursor teammate child extension registry", () => {
	it("is a no-op when maestro teammate is not loaded", () => {
		expect(registerCursorSdkTeammateChildExtension("/tmp/pi-cursor-sdk/dist/index.js")).toBe(false);
		expect(teammateChildExtensionTestUtils.getRegistry()).toBeUndefined();
	});

	it("registers the Cursor entry path and pi tools for teammate children", () => {
		const registry = installFakeRegistry();
		const extensionPath = "/tmp/pi-cursor-sdk/dist/index.js";

		expect(registerCursorSdkTeammateChildExtension(extensionPath)).toBe(true);
		expect([...registry.registrations.values()]).toEqual([
			{
				path: extensionPath,
				tools: [CURSOR_ASK_QUESTION_TOOL_NAME, CURSOR_ACTIVATE_SKILL_TOOL_NAME],
			},
		]);
		expect(CURSOR_TEAMMATE_CHILD_TOOL_NAMES).toEqual([
			CURSOR_ASK_QUESTION_TOOL_NAME,
			CURSOR_ACTIVATE_SKILL_TOOL_NAME,
		]);
	});

	it("replaces a previous registration for the same path", () => {
		const registry = installFakeRegistry();
		const extensionPath = "/tmp/pi-cursor-sdk/dist/index.js";
		expect(registerCursorSdkTeammateChildExtension(extensionPath)).toBe(true);
		expect(registerCursorSdkTeammateChildExtension(extensionPath)).toBe(true);
		expect(registry.registrations.size).toBe(1);
	});

	it("registers on session_start once the teammate registry exists", async () => {
		const pi = createEventHarness();
		const entryHref = pathToFileURL("/tmp/pi-cursor-sdk/dist/index.js").href;
		registerCursorTeammateChildExtensionLifecycle(pi, entryHref);
		expect(teammateChildExtensionTestUtils.getRegistry()).toBeUndefined();

		const registry = installFakeRegistry();
		await pi.runSessionStart();

		expect([...registry.registrations.values()].map((registration) => registration.path)).toEqual([
			"/tmp/pi-cursor-sdk/dist/index.js",
		]);
	});

	it("registers on before_agent_start after maestro plants the registry", async () => {
		const pi = createEventHarness();
		const entryHref = pathToFileURL("/tmp/pi-cursor-sdk/dist/index.js").href;
		registerCursorTeammateChildExtensionLifecycle(pi, entryHref);
		await pi.runSessionStart();
		expect(teammateChildExtensionTestUtils.getRegistry()).toBeUndefined();

		const registry = installFakeRegistry();
		await pi.runBeforeAgentStart();

		expect([...registry.registrations.values()].map((registration) => registration.path)).toEqual([
			"/tmp/pi-cursor-sdk/dist/index.js",
		]);
	});
});

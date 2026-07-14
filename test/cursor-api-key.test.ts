import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent";
import { __resetDirsFromEnvForTests, setAgentDir } from "@oh-my-pi/pi-utils";
import {
	CURSOR_API_KEY_CONFIG_VALUE,
	resolveCursorApiKey,
	resolveCursorRuntimeApiKey,
} from "../src/cursor-api-key.js";
import { getAgentDbPath } from "../src/host-agent-paths.js";

async function writeStoredCursorApiKey(apiKey: string): Promise<void> {
	const storage = await AuthStorage.create(getAgentDbPath());
	await storage.set("cursor", { type: "api_key", key: apiKey });
}

describe("cursor-api-key helpers", () => {
	const originalEnv = process.env;
	const originalArgv = process.argv;
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	let tmpAgentDir: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env.CURSOR_API_KEY;
		tmpAgentDir = mkdtempSync(join(tmpdir(), "pi-cursor-api-key-"));
		setAgentDir(tmpAgentDir);
		process.argv = ["node", "vitest"];
	});

	afterEach(() => {
		rmSync(tmpAgentDir, { recursive: true, force: true });
		process.env = originalEnv;
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		__resetDirsFromEnvForTests();
		process.argv = originalArgv;
	});

	it.each(["CURSOR_API_KEY", "$CURSOR_API_KEY", "${CURSOR_API_KEY}", CURSOR_API_KEY_CONFIG_VALUE])(
		"resolves placeholder %s through env only",
		(placeholder) => {
			expect(resolveCursorApiKey(placeholder)).toBeUndefined();
			process.env.CURSOR_API_KEY = "env-key-123";
			expect(resolveCursorApiKey(placeholder)).toBe("env-key-123");
		},
	);

	it("ignores every process argv form and resolves stored auth before env", async () => {
		process.argv = [
			"node", "pi", "--model", "anthropic/first", "--api-key", "first-key",
			"--MODEL", "cursor/case", "--API-KEY", "case-key",
			"--model=cursor/unsupported", "--api-key=equals-key",
			"--models", "cursor/list-like", "--provider", "cursor",
			"--model", "cursor/final", "--api-key", "last-key",
		];
		expect(await resolveCursorRuntimeApiKey()).toBeUndefined();

		process.env.CURSOR_API_KEY = "env-key-123";
		expect(await resolveCursorRuntimeApiKey()).toBe("env-key-123");

		await writeStoredCursorApiKey("stored-key-123");
		expect(await resolveCursorRuntimeApiKey()).toBe("stored-key-123");
	});

	it("resolves stored placeholders through env", async () => {
		await writeStoredCursorApiKey(CURSOR_API_KEY_CONFIG_VALUE);
		process.env.CURSOR_API_KEY = "env-key-123";

		expect(await resolveCursorRuntimeApiKey()).toBe("env-key-123");
	});
});

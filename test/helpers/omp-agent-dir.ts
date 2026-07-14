import { mkdirSync } from "node:fs";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent";
import { __resetDirsFromEnvForTests, setAgentDir } from "@oh-my-pi/pi-utils";
import { setCursorSdkModuleForTests } from "../../src/cursor-sdk-runtime.js";

/** Point omp agent paths at an isolated temp dir for the duration of a test. */
export function installTempAgentDir(tmpAgentDir: string): void {
	mkdirSync(tmpAgentDir, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
	setAgentDir(tmpAgentDir);
}

/** Restore omp directory resolution after a test mutates PI_CODING_AGENT_DIR / setAgentDir. */
export function restoreAgentDirFromEnv(): void {
	__resetDirsFromEnvForTests();
	setCursorSdkModuleForTests(undefined);
}

/** Persist a Cursor API key the way omp AuthStorage expects (SQLite agent.db). */
export async function writeStoredCursorApiKey(apiKey: string): Promise<void> {
	const { getAgentDbPath } = await import("../../src/host-agent-paths.js");
	const storage = await AuthStorage.create(getAgentDbPath());
	try {
		await storage.set("cursor", { type: "api_key", key: apiKey, source: "login" });
	} finally {
		storage.close();
	}
}

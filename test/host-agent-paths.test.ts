import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@oh-my-pi/pi-utils", () => ({
	CONFIG_DIR_NAME: ".omp",
	getAgentDir: () => path.join("/tmp/fake-home", ".omp", "agent"),
}));

describe("host-agent-paths", () => {
	it("re-exports CONFIG_DIR_NAME and getAgentDir from @oh-my-pi/pi-utils", async () => {
		const mod = await import("../src/host-agent-paths.js");
		expect(mod.CONFIG_DIR_NAME).toBe(".omp");
		expect(mod.getAgentDir()).toContain(`${path.sep}.omp${path.sep}agent`);
	});
});

import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@oh-my-pi/pi-coding-agent", () => ({
	getAgentDir: () => path.join("/tmp/fake-home", ".omp", "agent"),
}));

describe("host-agent-paths", () => {
	it("derives CONFIG_DIR_NAME from getAgentDir parent", async () => {
		const mod = await import("../src/host-agent-paths.js");
		expect(mod.CONFIG_DIR_NAME).toBe(".omp");
		expect(mod.getAgentDir()).toContain(`${path.sep}.omp${path.sep}agent`);
	});
});

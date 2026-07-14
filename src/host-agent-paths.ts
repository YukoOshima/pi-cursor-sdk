import path from "node:path";
import { getAgentDir as getHostAgentDir } from "@oh-my-pi/pi-coding-agent";

function deriveConfigDirName(agentDir: string): string {
	const parent = path.basename(path.dirname(path.resolve(agentDir)));
	if (parent === ".omp" || parent === ".pi") return parent;
	if (typeof process.env.PI_CONFIG_DIR === "string" && process.env.PI_CONFIG_DIR.trim()) {
		return process.env.PI_CONFIG_DIR.trim();
	}
	return ".pi";
}

export function getAgentDir(): string {
	return getHostAgentDir();
}

export const CONFIG_DIR_NAME: string = deriveConfigDirName(getAgentDir());

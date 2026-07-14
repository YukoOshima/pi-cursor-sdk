import type { BuildSystemPromptOptions } from "@oh-my-pi/pi-coding-agent";
import {
	PI_PROJECT_INSTRUCTIONS_OPEN_PREFIX,
	serializePiProjectContextSection,
	serializePiProjectInstructionsBlock,
	type PiAgentsContextFile,
} from "../../src/cursor-agents-context.js";

export { PI_PROJECT_INSTRUCTIONS_OPEN_PREFIX, serializePiProjectContextSection, serializePiProjectInstructionsBlock };

/** Test-only options bag — omp BuildSystemPromptOptions no longer carries contextFiles. */
export type TestSystemPromptOptions = BuildSystemPromptOptions & {
	contextFiles?: PiAgentsContextFile[];
	selectedTools?: string[];
	skills?: unknown[];
};

export function makeSystemPromptOptions(
	contextFiles: PiAgentsContextFile[],
	cwd = "/repo",
): TestSystemPromptOptions {
	return { cwd, contextFiles };
}

/** Minimal pi-like system prompt containing only the project_context subset this feature owns. */
export function buildPiSystemPromptWithContextFiles(
	contextFiles: PiAgentsContextFile[],
	cwd = "/repo",
): string {
	let prompt =
		"You are an expert coding assistant operating inside pi, a coding agent harness.\n\nGuidelines:\n- Be concise in your responses";
	prompt += serializePiProjectContextSection(contextFiles);
	prompt += `\nCurrent date: 2026-01-01\nCurrent working directory: ${cwd}`;
	return prompt;
}

import { vi } from "vitest";
import type { ExtensionAPI, ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import type { CursorNativeToolDisplayExtensionApi } from "../../src/cursor-native-tool-display-registration.js";
import type cursorExtensionFactory from "../../src/index.js";
import { createExtensionCommandContext } from "./context-fixtures.js";
import { createHarnessEventApi } from "./event-harness.js";
import {
	DEFAULT_ACTIVE_TOOL_NAMES,
	DEFAULT_BUILTIN_TOOL_NAMES,
	createBuiltinToolInfo,
} from "./tool-fixtures.js";
import type {
	BridgePiHarness,
	ExtensionCommandContextOverrides,
	HarnessToolInfo,
	PiHarness,
	PiHarnessOptions,
	RegisteredCommandOptions,
	RegisteredTool,
} from "./pi-harness-types.js";

/** Pi harness surface accepted by `src/index.ts` extension factory registration. */
export type CursorExtensionRegistrationPi = Parameters<typeof cursorExtensionFactory>[0];

function toolNameOf(tool: string | HarnessToolInfo): string {
	return typeof tool === "string" ? tool : tool.name;
}

export function createBridgePiHarness(options: {
	active: string[];
	tools: Array<string | HarnessToolInfo>;
}): BridgePiHarness {
	const eventApi = createHarnessEventApi();
	const toolNames = options.tools.map(toolNameOf);
	const metadataByName = new Map<string, HarnessToolInfo>();
	for (const tool of options.tools) {
		if (typeof tool === "string") continue;
		metadataByName.set(tool.name, tool);
	}
	return {
		...eventApi,
		getActiveTools: vi.fn<ExtensionAPI["getActiveTools"]>(() => [...options.active]),
		getAllTools: vi.fn<ExtensionAPI["getAllTools"]>(() => [...toolNames]),
		getToolMetadata: (toolName: string) => {
			const tool = metadataByName.get(toolName);
			if (!tool) return undefined;
			return {
				description: tool.description,
				parameters: tool.parameters,
				promptGuidelines: tool.promptGuidelines,
				sourceInfo: tool.sourceInfo,
			};
		},
		setActiveTools: vi.fn<ExtensionAPI["setActiveTools"]>(async () => undefined),
	};
}

/** Canonical configurable fake pi surface for extension, provider, and session tests. */
export function createPiHarness(options: PiHarnessOptions = {}): PiHarness {
	const eventApi = createHarnessEventApi();
	const registered: Array<{ name: string; config: ProviderConfig }> = [];
	const commands = new Map<string, RegisteredCommandOptions>();
	const tools: RegisteredTool[] = [];
	const initialTools =
		options.initialTools ?? [...DEFAULT_BUILTIN_TOOL_NAMES].map((name) => createBuiltinToolInfo(name));
	let activeToolNames = [...(options.activeTools ?? DEFAULT_ACTIVE_TOOL_NAMES)];

	const resolveFlagValue = (name: string): boolean | string | undefined => {
		if (Object.prototype.hasOwnProperty.call(options.flagValues ?? {}, name)) {
			return options.flagValues?.[name];
		}
		return options.defaultFlagValue ?? false;
	};

	const runCommand = async (
		name: string,
		args = "",
		ctxOverrides: ExtensionCommandContextOverrides = {},
	): Promise<void> => {
		const command = commands.get(name);
		if (!command) {
			throw new Error(`Command not registered: ${name}`);
		}
		await command.handler(args, createExtensionCommandContext(ctxOverrides));
	};

	const registerTool = vi.fn<ExtensionAPI["registerTool"]>((tool) => {
		tools.push(tool as RegisteredTool);
	}) as PiHarness["registerTool"];

	return {
		...eventApi,
		registerProvider: vi.fn<ExtensionAPI["registerProvider"]>((name: string, config: ProviderConfig) => {
			registered.push({ name, config });
		}),
		registerFlag: vi.fn<ExtensionAPI["registerFlag"]>(),
		registerCommand: vi.fn<ExtensionAPI["registerCommand"]>((name: string, command) => {
			commands.set(name, command);
		}),
		registerTool,
		getAllTools: vi.fn<ExtensionAPI["getAllTools"]>(() => {
			const names = new Set<string>();
			for (const tool of initialTools) names.add(toolNameOf(tool));
			for (const tool of tools) names.add(tool.name);
			return [...names];
		}),
		getToolMetadata: (toolName: string) => {
			const registered = tools.find((tool) => tool.name === toolName);
			if (registered) {
				return {
					description: registered.description,
					parameters: registered.parameters,
					promptGuidelines: (registered as { promptGuidelines?: string[] }).promptGuidelines,
					sourceInfo: (registered as { sourceInfo?: Record<string, unknown> }).sourceInfo,
				};
			}
			const initial = initialTools.find((tool) => toolNameOf(tool) === toolName);
			if (!initial || typeof initial === "string") return undefined;
			return {
				description: initial.description,
				parameters: initial.parameters,
				promptGuidelines: initial.promptGuidelines,
				sourceInfo: initial.sourceInfo,
			};
		},
		getActiveTools: vi.fn<ExtensionAPI["getActiveTools"]>(() => [...activeToolNames]),
		setActiveTools: vi.fn<ExtensionAPI["setActiveTools"]>(async (toolNames: string[]) => {
			activeToolNames = [...toolNames];
		}),
		sendMessage: vi.fn<ExtensionAPI["sendMessage"]>(),
		getFlag: vi.fn<ExtensionAPI["getFlag"]>((name: string) => resolveFlagValue(name)),
		appendEntry: vi.fn<ExtensionAPI["appendEntry"]>(),
		runCommand,
		_registered: registered,
		_commands: commands,
		_tools: tools,
		_activeToolNames: () => [...activeToolNames],
	};
}

export function createExtensionRegistrationPi(
	options: PiHarnessOptions = {},
): PiHarness & CursorExtensionRegistrationPi {
	const harness = createPiHarness(options);
	return harness as PiHarness & CursorExtensionRegistrationPi;
}

export type { CursorNativeToolDisplayExtensionApi };

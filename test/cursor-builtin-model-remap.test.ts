import { describe, expect, it, vi } from "vitest";
import {
	isStaleCursorBuiltinModel,
	mapBuiltinCursorModelIdToSdkPlan,
	rebaseStaleCursorBuiltinModel,
	resolveCursorSdkReplacement,
} from "../src/cursor-builtin-model-remap.js";

function makeRegistry(models: Array<{ id: string; provider: string; api: string }>) {
	return {
		find(provider: string, id: string) {
			return models.find((model) => model.provider === provider && model.id === id);
		},
		getAll() {
			return models;
		},
	};
}

describe("mapBuiltinCursorModelIdToSdkPlan", () => {
	it("maps built-in grok effort ids onto SDK catalog ids", () => {
		expect(mapBuiltinCursorModelIdToSdkPlan("cursor-grok-4.5-high")).toEqual({
			candidates: ["grok-4.5"],
			thinkingLevel: "high",
		});
		expect(mapBuiltinCursorModelIdToSdkPlan("cursor-grok-4.5-high-fast")).toEqual({
			candidates: ["grok-4.5:fast", "grok-4.5"],
			thinkingLevel: "high",
		});
		expect(mapBuiltinCursorModelIdToSdkPlan("cursor-grok-4.5-medium-fast")).toEqual({
			candidates: ["grok-4.5:fast", "grok-4.5"],
			thinkingLevel: "medium",
		});
	});
});

describe("isStaleCursorBuiltinModel", () => {
	it("detects dangling cursor-agent selections after SDK catalog replace", () => {
		const registry = makeRegistry([
			{ id: "grok-4.5", provider: "cursor", api: "cursor-sdk" },
			{ id: "grok-4.5:fast", provider: "cursor", api: "cursor-sdk" },
		]);
		expect(
			isStaleCursorBuiltinModel(
				{ id: "cursor-grok-4.5-high", provider: "cursor", api: "cursor-agent" },
				registry,
			),
		).toBe(true);
		expect(
			isStaleCursorBuiltinModel({ id: "grok-4.5", provider: "cursor", api: "cursor-sdk" }, registry),
		).toBe(false);
	});
});

describe("resolveCursorSdkReplacement", () => {
	it("prefers :fast when the built-in id includes -fast", () => {
		const registry = makeRegistry([
			{ id: "grok-4.5", provider: "cursor", api: "cursor-sdk" },
			{ id: "grok-4.5:fast", provider: "cursor", api: "cursor-sdk" },
		]);
		expect(
			resolveCursorSdkReplacement(
				{ id: "cursor-grok-4.5-high-fast", provider: "cursor", api: "cursor-agent" },
				registry,
			),
		).toEqual({
			model: { id: "grok-4.5:fast", provider: "cursor", api: "cursor-sdk" },
			thinkingLevel: "high",
		});
	});
});

describe("rebaseStaleCursorBuiltinModel", () => {
	it("calls setModel/setThinkingLevel for a stale built-in selection", async () => {
		const sdkModel = { id: "grok-4.5:fast", provider: "cursor", api: "cursor-sdk" };
		const registry = makeRegistry([
			{ id: "grok-4.5", provider: "cursor", api: "cursor-sdk" },
			sdkModel,
		]);
		const setModel = vi.fn().mockResolvedValue(true);
		const setThinkingLevel = vi.fn();

		const switched = await rebaseStaleCursorBuiltinModel({
			model: { id: "cursor-grok-4.5-high-fast", provider: "cursor", api: "cursor-agent" },
			modelRegistry: registry,
			setModel,
			setThinkingLevel,
		});

		expect(switched).toBe(true);
		expect(setModel).toHaveBeenCalledWith(sdkModel);
		expect(setThinkingLevel).toHaveBeenCalledWith("high");
	});

	it("no-ops when the SDK catalog is absent", async () => {
		const setModel = vi.fn().mockResolvedValue(true);
		const switched = await rebaseStaleCursorBuiltinModel({
			model: { id: "cursor-grok-4.5-high", provider: "cursor", api: "cursor-agent" },
			modelRegistry: makeRegistry([]),
			setModel,
		});
		expect(switched).toBe(false);
		expect(setModel).not.toHaveBeenCalled();
	});
});

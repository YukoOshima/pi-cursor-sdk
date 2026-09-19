import { describe, expect, it } from "vitest";
import type { ToolCall } from "@earendil-works/pi-ai";
import { isJsonObject } from "../src/cursor-record-utils.js";

describe("Pi transcript tool arguments", () => {
	it("narrows JSON without cloning, dropping fields, or changing values", () => {
		const shared = { value: null };
		const input: unknown = { nested: [shared, shared, false, 0, ""], object: {} };
		if (!isJsonObject(input)) throw new Error("Expected JSON arguments");
		const call: ToolCall = { type: "toolCall", id: "json", name: "test", arguments: input };
		expect(call.arguments).toBe(input);
		expect(call.arguments).toEqual({ nested: [shared, shared, false, 0, ""], object: {} });
	});

	it("does not admit non-JSON SDK values or cyclic arguments", () => {
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		for (const value of [undefined, [], null, { absent: undefined }, { fn() {} }, { value: 1n }, { value: NaN }, { value: new Date() }, cycle]) {
			expect(isJsonObject(value)).toBe(false);
		}
	});
});

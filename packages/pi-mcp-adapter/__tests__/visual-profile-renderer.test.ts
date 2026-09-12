import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderVisualProfileMcpResult } from "../visual-profile-renderer.ts";

type Details = Record<string, unknown> & { error?: unknown };
type Result = AgentToolResult<Details>;

const theme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
};

function result(content: Result["content"], details: Details = {}): Result {
	return { content, details };
}

describe("visual-profile MCP renderer", () => {
	it("keeps server and operation visible in a bounded collapsed box", () => {
		const output = renderVisualProfileMcpResult(
			result([{ type: "text", text: "\u001b[32m漢字🙂 combining e\u0301 output that is deliberately longer than the card\u001b[0m" }], {
				mode: "call",
				server: "docs",
				tool: "search",
			}),
			{ expanded: false, isPartial: false },
			theme,
			{ borderStyle: "rounded", glyphMode: "unicode", padding: 1 },
		).render(24);

		expect(output.join("\n")).toContain("docs/search");
		expect(output.join("\n")).toContain("Succeeded");
		for (const line of output) expect(line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").length).toBeLessThanOrEqual(24);
	});

	it("renders a textual pending state", () => {
		const output = renderVisualProfileMcpResult(
			result([]),
			{ expanded: false, isPartial: true },
			theme,
			{ borderStyle: "sharp", glyphMode: "ascii", padding: 0 },
		).render(80).join("\n");

		expect(output).toContain("Running");
		expect(output).toContain("MCP");
	});

	it("labels success, empty, and failed results textually", () => {
		const cases: Array<{ result: Result; options: { expanded: boolean; isPartial: boolean }; expected: string }> = [
			{ result: result([{ type: "text", text: "ok" }]), options: { expanded: false, isPartial: false }, expected: "Succeeded" },
			{ result: result([]), options: { expanded: false, isPartial: false }, expected: "Empty result" },
			{ result: result([{ type: "text", text: "transport disconnected" }], { error: "transport" }), options: { expanded: false, isPartial: false }, expected: "Failed" },
		];

		for (const testCase of cases) {
			const output = renderVisualProfileMcpResult(
				testCase.result,
				testCase.options,
				theme,
				{ borderStyle: "rounded", glyphMode: "unicode", padding: 1 },
			).render(48).join("\n");
			expect(output).toContain(testCase.expected);
		}
	});

	it("keeps a hierarchical identity, argument summary, and expansion affordance in the collapsed card", () => {
		const output = renderVisualProfileMcpResult(
			result([{ type: "text", text: "first line\nsecond line\nthird line\nfourth line" }], {
				mode: "call",
				server: "plane",
				tool: "get_work_item",
			}),
			{ expanded: false, isPartial: false },
			theme,
			{ borderStyle: "rounded", glyphMode: "unicode", padding: 1 },
			{ title: "mcp call get_work_item @ plane", inputPreview: '{ "identifier": "PI-31" }' },
		).render(48).join("\n");

		expect(output).toContain("plane/get_work_item");
		expect(output).toContain("identifier");
		expect(output).toContain("Succeeded");
		expect(output).toContain("Ctrl+O to expand");
		expect(output).not.toContain("fourth line");
	});

	it("shows complete multiline output when expanded and keeps every line within terminal width", () => {
		const output = renderVisualProfileMcpResult(
			result([{ type: "text", text: "\u001b[32m漢字🙂 e\u0301\u001b[0m\nsecond line\nthird line\nfourth line" }], {
				mode: "call",
				server: "plane",
				tool: "get_work_item",
			}),
			{ expanded: true, isPartial: false },
			theme,
			{ borderStyle: "rounded", glyphMode: "unicode", padding: 1 },
		).render(24);

		expect(output.join("\n")).toContain("fourth line");
		for (const line of output) expect(visibleWidth(line)).toBeLessThanOrEqual(24);
	});
});

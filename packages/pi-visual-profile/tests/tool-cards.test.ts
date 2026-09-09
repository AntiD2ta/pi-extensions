import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createToolRendererProfile } from "../tool-cards.ts";

test("profile supplies one boxed header renderer for read, search, list, and shell tools", () => {
	const profile = createToolRendererProfile();

	assert.deepEqual(Object.keys(profile.tools), ["read", "grep", "find", "ls", "bash", "powershell"]);
	for (const renderer of Object.values(profile.tools)) {
		assert.equal(typeof renderer?.renderCall, "function");
	}
});

test("minimal cards render without Pi's default tool shell", () => {
	const profile = createToolRendererProfile("minimal");

	for (const renderer of Object.values(profile.tools)) {
		assert.equal(renderer.renderShell, "self");
	}
});

test("tool headers remove terminal controls from arguments", () => {
	const renderer = createToolRendererProfile().tools.bash!;
	const state: Record<string, unknown> = {};
	const component = renderer.renderCall(
		{},
		{
			fg: (_color, text) => text,
			bold: (text) => text,
		},
		{
			args: { command: "echo safe\u001b]52;c;clipboard\u0007" },
			cwd: process.cwd(),
			executionStarted: true,
			expanded: false,
			isError: false,
			isPartial: true,
			lastComponent: undefined,
			state,
		},
	);

	assert.equal(stripTerminalSequences(component.render(80)[0]!), "bash echo safe [running]");
	assert.equal(typeof state.startedAt, "number");
});

test("tool headers retain a textual state and fit narrow widths", () => {
	const renderer = createToolRendererProfile().tools.grep!;
	const component = renderer.renderCall(
		{},
		{
			fg: (_color, text) => text,
			bold: (text) => text,
		},
		{
			args: { pattern: "toolRendererProfile", path: "packages/pi-visual-profile/a-very-long-directory-name" },
			cwd: process.cwd(),
			executionStarted: true,
			expanded: false,
			isError: false,
			isPartial: false,
			lastComponent: undefined,
			state: {},
		},
	);
	const line = stripTerminalSequences(component.render(30)[0]!);

	assert.match(line, /^grep /);
	assert.match(line, /\[success\]$/);
	assert.ok(visibleWidth(line) <= 30);
});

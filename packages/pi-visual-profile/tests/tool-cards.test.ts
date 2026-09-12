import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, Text, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { mutationRendererProfile } from "../mutation-cards.ts";
import { createToolRendererProfile, type ToolCardMouseEvent, type ToolCardMouseEventResult, type ToolCardTheme } from "../tool-cards.ts";

const theme: ToolCardTheme = {
	bg: (_color, text) => text,
	fg: (_color, text) => text,
};

type MouseCapableComponent = Component & {
	handleMouse?: (event: ToolCardMouseEvent) => ToolCardMouseEventResult | undefined;
};

function withMouseHandling(component: Component): MouseCapableComponent {
	return component as MouseCapableComponent;
}

test("tool profile retains semantic edit fallback renderers", () => {
	const profile = createToolRendererProfile("boxed", theme, mutationRendererProfile("stacked"));

	assert.equal(profile.tools.edit?.renderShell, "self");
	assert.equal(profile.tools.write, undefined);
});

test("boxed frame matches the PR 4 rounded card layout", () => {
	const frame = createToolRendererProfile("boxed", theme).frame({
		call: new Text("read README.md", 0, 0),
		result: new Text("native highlighted result\n… ctrl+e to expand", 0, 0),
		state: "success",
		expandKeyText: "ctrl+e",
	});
	const lines = frame.render(40).map(stripTerminalSequences);

	assert.deepEqual(lines, [
		"╭──────────────────────────────────────╮",
		"│ read README.md › Succeeded           │",
		"├──────────────────────────────────────┤",
		"│ native highlighted result            │",
		"│ … ctrl+e to expand                   │",
		"╰──────────────────────────────────────╯",
	]);
	for (const line of lines) assert.equal(visibleWidth(line), 40);
});

test("boxed frame does not add an expansion hint to a complete native result", () => {
	const frame = createToolRendererProfile("boxed", theme).frame({
		call: new Text("find *.ts", 0, 0),
		result: new Text("one result", 0, 0),
		state: "success",
		expandKeyText: "ctrl+e",
	});
	const output = stripTerminalSequences(frame.render(40).join("\n"));

	assert.doesNotMatch(output, /to expand/);
});

test("boxed frame renders PR 4 state labels with state backgrounds", () => {
	const recordingTheme: ToolCardTheme = {
		bg: (color, text) => `<${color}>${text}</${color}>`,
		fg: (_color, text) => text,
	};
	const cases = [
		{ state: "pending" as const, label: "› Running", background: "toolPendingBg" },
		{ state: "success" as const, label: "› Succeeded", background: "toolSuccessBg" },
		{ state: "error" as const, label: "› Failed", background: "toolErrorBg" },
	];

	for (const entry of cases) {
		const frame = createToolRendererProfile("boxed", recordingTheme).frame({
			call: new Text("bash echo", 0, 0),
			result: new Text("output", 0, 0),
			state: entry.state,
			expandKeyText: "ctrl+e",
		});
		const output = stripTerminalSequences(frame.render(40).join("\n"));

		assert.match(output, new RegExp(entry.label));
		assert.match(output, new RegExp(`<${entry.background}>`));
	}
});

test("boxed frame truncates a long call before placing status on its own row", () => {
	const frame = createToolRendererProfile("boxed", theme).frame({
		call: new Text("bash printf a-command-that-is-longer-than-the-card", 0, 0),
		result: new Text("漢字🙂 result that wraps across the card width", 0, 0),
		state: "success",
		expandKeyText: "ctrl+e",
	});
	const lines = frame.render(24).map(stripTerminalSequences);

	assert.match(lines[1]!, /^│ bash printf/);
	const divider = lines.findIndex((line) => line.startsWith("├"));
	assert.equal(lines[divider - 1], "│ › Succeeded          │");
	assert.match(lines[divider]!, /^├/);
	for (const line of lines) {
		assert.equal(visibleWidth(line), 24);
		assert.ok(line.startsWith("│") && line.endsWith("│") || /^[╭├╰].*[╮┤╯]$/.test(line));
	}
});

test("boxed frame keeps native call lines separate", () => {
	const frame = createToolRendererProfile("boxed", theme).frame({
		call: new Text("read first line\nsecond line", 0, 0),
		result: undefined,
		state: "success",
		expandKeyText: "ctrl+e",
	});
	const lines = frame.render(40).map(stripTerminalSequences);

	assert.equal(lines[1], "│ read first line                      │");
	assert.equal(lines[2], "│ second line › Succeeded              │");
});

test("boxed frame leaves native image rows untouched", () => {
	const imageLine = "\u001b_Gf=100,a=T;image-data\u001b\\";
	const frame = createToolRendererProfile("boxed", theme).frame({
		call: new Text("read image.png", 0, 0),
		result: {
			render: () => ["", imageLine],
			invalidate() {},
		},
		state: "success",
		expandKeyText: "ctrl+e",
	});

	assert.ok(frame.render(40).includes(imageLine));
});

test("boxed frame preserves an image when it is the first native result row", () => {
	const imageLine = "\u001b_Gf=100,a=T;image-data\u001b\\";
	const frame = createToolRendererProfile("boxed", theme).frame({
		call: new Text("read image.png", 0, 0),
		result: {
			render: () => [imageLine],
			invalidate() {},
		},
		state: "success",
		expandKeyText: "ctrl+e",
	});

	assert.ok(frame.render(40).includes(imageLine));
});

test("boxed frame removes the native shell spacer before the result", () => {
	const result = {
		render: () => ["\u001b[31m \u001b[0m", "native result"],
		invalidate() {},
	};
	const frame = createToolRendererProfile("boxed", theme).frame({
		call: new Text("grep /profile/", 0, 0),
		result,
		state: "success",
		expandKeyText: "ctrl+e",
	});
	const lines = frame.render(40).map(stripTerminalSequences);

	assert.equal(lines[3], "│ native result                        │");
});

test("boxed frame delegates mouse input to native call and result regions", () => {
	const received: string[] = [];
	const region = (name: string) => ({
		render: () => [name],
		handleMouse: () => {
			received.push(name);
			return { handled: true };
		},
		invalidate() {},
	});
	const frame = createToolRendererProfile("boxed", theme).frame({
		call: region("call"),
		result: region("result"),
		state: "success",
		expandKeyText: "ctrl+e",
	});
	frame.render(40);
	const event: ToolCardMouseEvent = {
		type: "click",
		button: "left",
		x: 2,
		y: 1,
		screenX: 2,
		screenY: 1,
		width: 40,
		height: 5,
		shift: false,
		alt: false,
		ctrl: false,
	};

	assert.equal(withMouseHandling(frame).handleMouse?.(event)?.handled, true);
	assert.equal(withMouseHandling(frame).handleMouse?.({ ...event, y: 3, screenY: 3 })?.handled, true);
	assert.deepEqual(received, ["call", "result"]);
});

test("boxed frame does not treat a wrapped status row as call content", () => {
	let callClicks = 0;
	const call = {
		render: () => ["a call that is wider than the card"],
		handleMouse: () => {
			callClicks += 1;
			return { handled: true };
		},
		invalidate() {},
	};
	const frame = createToolRendererProfile("boxed", theme).frame({
		call,
		result: undefined,
		state: "success",
		expandKeyText: "ctrl+e",
	});
	frame.render(24);
	const statusClick: ToolCardMouseEvent = {
		type: "click",
		button: "left",
		x: 2,
		y: 2,
		screenX: 2,
		screenY: 2,
		width: 24,
		height: 4,
		shift: false,
		alt: false,
		ctrl: false,
	};

	assert.equal(withMouseHandling(frame).handleMouse?.(statusClick), undefined);
	assert.equal(callClicks, 0);
});

test("minimal frame keeps native call and result without a border", () => {
	const frame = createToolRendererProfile("minimal", theme).frame({
		call: new Text("grep /profile/", 0, 0),
		result: new Text("native result", 0, 0),
		state: "pending",
		expandKeyText: "alt+o",
	});
	const output = stripTerminalSequences(frame.render(80).join("\n"));

	assert.match(output, /grep \/profile\//);
	assert.match(output, /native result/);
	assert.match(output, /\[running\]/);
	assert.match(output, /alt\+o to expand/);
	assert.doesNotMatch(output, /┌|╭/);
});

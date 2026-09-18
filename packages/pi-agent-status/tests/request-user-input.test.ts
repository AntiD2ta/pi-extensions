import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import extension from "../index.ts";

interface RegisteredTool {
	parameters?: unknown;
	execute: (toolCallId: string, params: Record<string, string>) => Promise<unknown>;
}

function createFakePi() {
	let tool: RegisteredTool | undefined;
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const entries: Array<{ customType: string; data: unknown }> = [];
	const widgets: Array<[string, string[] | undefined]> = [];
	const pi = {
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			handlers.set(event, handler);
		},
		registerTool(registered: RegisteredTool) {
			tool = registered;
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ customType, data });
		},
	};
	return {
		pi: pi as unknown as ExtensionAPI,
		entries,
		widgets,
		getHandler: (event: string) => handlers.get(event),
		getTool: () => tool,
	};
}

async function startSession(fake: ReturnType<typeof createFakePi>, mode: string) {
	const sessionStart = fake.getHandler("session_start");
	assert.ok(sessionStart);
	await sessionStart({ type: "session_start", reason: "startup" }, {
		mode,
		ui: {
			setWidget: (key: string, value: string[] | undefined) => fake.widgets.push([key, value]),
			theme: { fg: (_color: string, text: string) => text },
		},
		sessionManager: { getBranch: () => [] },
	});
}

interface RenderableTool extends RegisteredTool {
	renderResult: (
		result: { details: Record<string, string>; content: [] },
		options: Record<string, never>,
		theme: {
			fg: (_color: string, text: string) => string;
			bg: (color: string, text: string) => string;
			bold: (text: string) => string;
		},
	) => { render: (width: number) => string[] };
}

const inputRequest = {
	context: "The project has two database options.",
	question: "Which database should I use?",
	recommendedAnswer: "PostgreSQL",
	rationale: "It fits the existing deployment platform.",
	toolCallId: "request-1",
};

function renderInputRequest(
	tool: RegisteredTool,
	details: Record<string, string>,
	width: number,
	background = (_color: string, text: string) => text,
) {
	return (tool as RenderableTool).renderResult({ content: [], details }, {}, {
		fg: (_color, text) => text,
		bg: background,
		bold: (text) => text,
	}).render(width);
}

test("a TUI session shows Ready with its status timestamp above the editor", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 13, 14, 6, 9) });
	const fake = createFakePi();
	extension(fake.pi);
	assert.equal(fake.getTool(), undefined);

	await startSession(fake, "print");
	assert.equal(fake.getTool(), undefined);
	assert.deepEqual(fake.widgets, []);

	await startSession(fake, "tui");
	assert.ok(fake.getTool());
	assert.deepEqual(fake.widgets, [["agent-status", ["Ready · 14:06:09 -- 13:09:2026"]]]);
});

test("the status timestamp pads the year to four digits", async (t) => {
	const now = new Date(2026, 0, 2, 3, 4, 5);
	now.setFullYear(7);
	t.mock.timers.enable({ apis: ["Date"], now });
	const fake = createFakePi();
	extension(fake.pi);

	await startSession(fake, "tui");

	assert.deepEqual(fake.widgets, [["agent-status", ["Ready · 03:04:05 -- 02:01:0007"]]]);
});

test("the status timestamp is subdued beside the status label", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 13, 14, 6, 9) });
	const fake = createFakePi();
	extension(fake.pi);
	const sessionStart = fake.getHandler("session_start");
	assert.ok(sessionStart);

	await sessionStart({ type: "session_start", reason: "startup" }, {
		mode: "tui",
		ui: {
			setWidget: (key: string, value: string[] | undefined) => fake.widgets.push([key, value]),
			theme: { fg: (color: string, text: string) => `<${color}>${text}</${color}>` },
		},
		sessionManager: { getBranch: () => [] },
	});

	assert.deepEqual(fake.widgets, [["agent-status", [
		"<accent>Ready</accent><muted> · 14:06:09 -- 13:09:2026</muted>",
	]]]);
});

test("the status timestamp remains fixed until the status changes", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 13, 14, 6, 9) });
	const fake = createFakePi();
	extension(fake.pi);
	const settled = fake.getHandler("agent_settled");
	assert.ok(settled);
	const ctx = { mode: "tui", ui: {
		setWidget: (key: string, value: string[] | undefined) => fake.widgets.push([key, value]),
		theme: { fg: (_color: string, text: string) => text },
	} };

	await startSession(fake, "tui");
	await settled({ type: "agent_settled" }, ctx);
	t.mock.timers.tick(1000);
	await settled({ type: "agent_settled" }, ctx);

	assert.deepEqual(fake.widgets, [
		["agent-status", ["Ready · 14:06:09 -- 13:09:2026"]],
		["agent-status", ["Completed · 14:06:09 -- 13:09:2026"]],
	]);
});

test("a status change captures a new status timestamp", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 13, 14, 6, 9) });
	const fake = createFakePi();
	extension(fake.pi);
	const agentStart = fake.getHandler("agent_start");
	const agentEnd = fake.getHandler("agent_end");
	const settled = fake.getHandler("agent_settled");
	assert.ok(agentStart);
	assert.ok(agentEnd);
	assert.ok(settled);

	await startSession(fake, "tui");
	const ctx = { mode: "tui", ui: {
		setWidget: (key: string, value: string[] | undefined) => fake.widgets.push([key, value]),
		theme: { fg: (_color: string, text: string) => text },
	} };
	await agentStart({ type: "agent_start" }, ctx);
	t.mock.timers.tick(1000);
	await agentEnd({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
	await settled({ type: "agent_settled" }, ctx);

	assert.deepEqual(fake.widgets, [
		["agent-status", ["Ready · 14:06:09 -- 13:09:2026"]],
		["agent-status", undefined],
		["agent-status", ["Completed · 14:06:10 -- 13:09:2026"]],
	]);
});

test("request_user_input requires every decision field", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);

	assert.deepEqual((tool.parameters as { required?: string[] }).required, [
		"context",
		"question",
		"recommendedAnswer",
		"rationale",
	]);
});

test("request_user_input uses framed columns when the field heights are balanced", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);
	const lines = renderInputRequest(tool, inputRequest, 126);

	assert.equal(lines[0], `╭${"─".repeat(124)}╮`);
	assert.match(lines[1], /request_user_input\s+Needs input/);
	assert.ok(lines.some((line) => /│ Question\s+│ Recommended answer\s+│/.test(line)));
	assert.ok(lines.some((line) => /│ Context\s+│ Rationale\s+│/.test(line)));
	assert.equal(lines.at(-1), `╰${"─".repeat(124)}╯`);
	assert.equal(lines.every((line) => visibleWidth(line) === 126), true);
});

test("request_user_input stacks every field when Context makes the columns too uneven", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);
	const context = Array.from({ length: 15 }, (_, index) =>
		`- F${index + 1}: This finding contains enough detail to occupy several lines in a column.`).join("\n");
	const lines = renderInputRequest(tool, {
		...inputRequest,
		context,
		question: "Which findings should I fix?",
		recommendedAnswer: "Fix F1 only.",
		rationale: "F1 is the only actionable finding.",
	}, 126);
	const labels = ["Question", "Context", "Recommended answer", "Rationale"]
		.map((label) => lines.findIndex((line) => new RegExp(`^│ ${label}\\s+│$`).test(line)));

	assert.equal(labels.every((index) => index >= 0), true);
	assert.deepEqual(labels, [...labels].sort((left, right) => left - right));
	assert.equal(lines.some((line) => line.slice(1, -1).includes("│")), false);
	assert.equal(lines.every((line) => visibleWidth(line) === 126), true);
});

test("request_user_input stacks every field when the terminal is narrow", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);
	const lines = renderInputRequest(tool, inputRequest, 70);
	const labels = ["Question", "Context", "Recommended answer", "Rationale"]
		.map((label) => lines.findIndex((line) => new RegExp(`^│ ${label}\\s+│$`).test(line)));

	assert.equal(lines[0], `╭${"─".repeat(68)}╮`);
	assert.equal(labels.every((index) => index >= 0), true);
	assert.deepEqual(labels, [...labels].sort((left, right) => left - right));
	assert.equal(lines.every((line) => visibleWidth(line) === 70), true);
});

test("request_user_input preserves literal bullet markers", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);
	const lines = renderInputRequest(tool, { ...inputRequest, context: "- F1: Keep this marker." }, 70);

	assert.ok(lines.some((line) => line.includes("- F1: Keep this marker.")));
	assert.equal(lines.some((line) => line.includes("• F1")), false);
});

test("request_user_input keeps every field visible at emergency terminal widths", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);
	const output = renderInputRequest(tool, inputRequest, 4).join("").replaceAll(" ", "");

	for (const text of [
		"Question",
		inputRequest.question,
		"Context",
		inputRequest.context,
		"Recommended answer",
		inputRequest.recommendedAnswer,
		"Rationale",
		inputRequest.rationale,
	]) {
		assert.ok(output.includes(text.replaceAll(" ", "")));
	}
});

test("request_user_input keeps its frame and header when five columns are available", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);
	const lines = renderInputRequest(tool, inputRequest, 5);
	const output = lines.join("").replace(/[ │─╭╮╰╯├┤]/g, "");

	assert.equal(lines[0], "╭───╮");
	assert.ok(output.includes("request_user_input"));
	assert.ok(output.includes("Needsinput"));
	assert.ok(output.includes("Recommendedanswer"));
	assert.equal(lines.every((line) => visibleWidth(line) === 5), true);
});

test("request_user_input keeps advice fields tinted at emergency terminal widths", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);
	const tinted: string[] = [];
	renderInputRequest(tool, inputRequest, 4, (color, text) => {
		if (color === "toolPendingBg") tinted.push(text);
		return text;
	});
	const output = tinted.join("").replaceAll(" ", "");

	assert.ok(output.includes("request_user_input"));
	assert.ok(output.includes("Needsinput"));
	assert.ok(output.includes("Recommendedanswer"));
	assert.ok(output.includes(inputRequest.recommendedAnswer.replaceAll(" ", "")));
	assert.ok(output.includes("Rationale"));
	assert.ok(output.includes(inputRequest.rationale.replaceAll(" ", "")));
	assert.equal(output.includes("Context"), false);
});

test("request_user_input wraps field labels when the frame is very narrow", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);
	const output = renderInputRequest(tool, inputRequest, 12).join("").replace(/[ │─╭╮╰╯├┤]/g, "");

	assert.ok(output.includes("Question"));
	assert.ok(output.includes("Context"));
	assert.ok(output.includes("Recommendedanswer"));
	assert.ok(output.includes("Rationale"));
});

test("request_user_input tints Recommended answer and Rationale without tinting Context", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);
	const lines = renderInputRequest(tool, inputRequest, 70,
		(color, text) => color === "toolPendingBg" ? `<pending>${text}</pending>` : text);

	assert.ok(lines.some((line) => line.includes("Context") && !line.includes("<pending>")));
	assert.ok(lines.some((line) => line.includes("Recommended answer") && line.includes("<pending>")));
	assert.ok(lines.some((line) => line.includes("Rationale") && line.includes("<pending>")));
});

test("a nonblank interactive response resolves the pending input request", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	const input = fake.getHandler("input");
	assert.ok(tool);
	assert.ok(input);

	await tool.execute("request-1", {
		context: "The project has two database options.",
		question: "Which database should I use?",
		recommendedAnswer: "PostgreSQL",
		rationale: "It fits the existing deployment platform.",
	});

	await input({ type: "input", source: "rpc", text: "Use PostgreSQL.", images: undefined }, {});
	assert.deepEqual(fake.entries, []);

	await input({ type: "input", source: "interactive", text: "   ", images: undefined }, {});
	assert.deepEqual(fake.entries, []);

	const result = await input({
		type: "input",
		source: "interactive",
		text: "Use PostgreSQL.",
		images: [{ type: "image", data: "a", mimeType: "image/png" }],
	}, {});

	assert.deepEqual(result, { action: "continue" });
	assert.deepEqual(fake.entries, [{
		customType: "agent-status-input-resolution",
		data: { toolCallId: "request-1" },
	}]);
});

test("agent lifecycle projects terminal states above the editor", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 13, 14, 6, 9) });
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const agentStart = fake.getHandler("agent_start");
	const agentEnd = fake.getHandler("agent_end");
	const settled = fake.getHandler("agent_settled");
	const input = fake.getHandler("input");
	assert.ok(agentStart);
	assert.ok(agentEnd);
	assert.ok(settled);
	assert.ok(input);

	fake.widgets.length = 0;
	const ctx = {
		mode: "tui",
		ui: {
			setWidget: (key: string, value: string[] | undefined) => fake.widgets.push([key, value]),
			theme: { fg: (color: string, text: string) => `<${color}>${text}</${color}>` },
		},
	};
	await agentStart({ type: "agent_start" }, ctx);
	await agentEnd({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] }, ctx);
	await settled({ type: "agent_settled" }, ctx);
	await agentStart({ type: "agent_start" }, ctx);
	await agentEnd({ type: "agent_end", messages: [{ role: "assistant", stopReason: "aborted" }] }, ctx);
	await settled({ type: "agent_settled" }, ctx);
	await agentStart({ type: "agent_start" }, ctx);
	await agentEnd({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
	await settled({ type: "agent_settled" }, ctx);
	await input({ type: "input", source: "interactive", text: "   " }, ctx);
	await input({ type: "input", source: "interactive", text: "Continue." }, ctx);

	assert.deepEqual(fake.widgets, [
		["agent-status", undefined],
		["agent-status", ["<error>Failed</error><muted> · 14:06:09 -- 13:09:2026</muted>"]],
		["agent-status", undefined],
		["agent-status", ["<error>Interrupted</error><muted> · 14:06:09 -- 13:09:2026</muted>"]],
		["agent-status", undefined],
		["agent-status", ["<accent>Completed</accent><muted> · 14:06:09 -- 13:09:2026</muted>"]],
		["agent-status", ["<accent>Ready</accent><muted> · 14:06:09 -- 13:09:2026</muted>"]],
	]);
});

test("an unresolved input request takes precedence at settlement and resolves to Ready", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 13, 14, 6, 9) });
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	const input = fake.getHandler("input");
	const agentEnd = fake.getHandler("agent_end");
	const settled = fake.getHandler("agent_settled");
	assert.ok(tool);
	assert.ok(input);
	assert.ok(agentEnd);
	assert.ok(settled);

	fake.widgets.length = 0;
	const ctx = {
		mode: "tui",
		ui: {
			setWidget: (key: string, value: string[] | undefined) => fake.widgets.push([key, value]),
			theme: {
				fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
				bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
			},
		},
	};
	await tool.execute("request-1", {
		context: "The project has two database options.",
		question: "Which database should I use?",
		recommendedAnswer: "PostgreSQL",
		rationale: "It fits the existing deployment platform.",
	});
	assert.deepEqual(fake.widgets, []);
	await agentEnd({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] }, ctx);
	await settled({ type: "agent_settled" }, ctx);
	await agentEnd({ type: "agent_end", messages: [{ role: "assistant", stopReason: "aborted" }] }, ctx);
	await settled({ type: "agent_settled" }, ctx);
	await input({ type: "input", source: "interactive", text: "Use PostgreSQL." }, ctx);

	assert.deepEqual(fake.widgets, [
		["agent-status", [
			"<toolPendingBg><warning>Needs input</warning><muted> · 14:06:09 -- 13:09:2026</muted></toolPendingBg>",
		]],
		["agent-status", ["Ready · 14:06:09 -- 13:09:2026"]],
	]);
});

test("the latest agent end replaces an earlier terminal result", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 13, 14, 6, 9) });
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const agentEnd = fake.getHandler("agent_end");
	const settled = fake.getHandler("agent_settled");
	assert.ok(agentEnd);
	assert.ok(settled);

	const widgets: Array<[string, string[] | undefined]> = [];
	const ctx = {
		mode: "tui",
		ui: {
			setWidget: (key: string, value: string[] | undefined) => widgets.push([key, value]),
			theme: { fg: (_color: string, text: string) => text },
		},
	};
	await agentEnd({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] }, ctx);
	await agentEnd({ type: "agent_end", messages: [{ role: "assistant", stopReason: "aborted" }] }, ctx);
	await settled({ type: "agent_settled" }, ctx);

	assert.deepEqual(widgets, [["agent-status", ["Interrupted · 14:06:09 -- 13:09:2026"]]]);
});

test("a session reload discards terminal presentation state", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 13, 14, 6, 9) });
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const agentEnd = fake.getHandler("agent_end");
	const settled = fake.getHandler("agent_settled");
	const sessionStart = fake.getHandler("session_start");
	assert.ok(agentEnd);
	assert.ok(settled);
	assert.ok(sessionStart);

	const widgets: Array<[string, string[] | undefined]> = [];
	const ctx = {
		mode: "tui",
		ui: {
			setWidget: (key: string, value: string[] | undefined) => widgets.push([key, value]),
			theme: { fg: (_color: string, text: string) => text },
		},
		sessionManager: { getBranch: () => [] },
	};
	await agentEnd({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] }, ctx);
	await settled({ type: "agent_settled" }, ctx);
	await sessionStart({ type: "session_start", reason: "reload" }, ctx);

	assert.deepEqual(widgets, [
		["agent-status", ["Failed · 14:06:09 -- 13:09:2026"]],
		["agent-status", ["Ready · 14:06:09 -- 13:09:2026"]],
	]);
});

test("resuming restores an unanswered input request", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 13, 14, 6, 9) });
	const fake = createFakePi();
	extension(fake.pi);
	const sessionStart = fake.getHandler("session_start");
	const input = fake.getHandler("input");
	assert.ok(sessionStart);
	assert.ok(input);
	const widgets: Array<[string, string[] | undefined]> = [];

	await sessionStart({ type: "session_start", reason: "resume" }, {
		mode: "tui",
		ui: {
			setWidget: (key: string, value: string[] | undefined) => widgets.push([key, value]),
			theme: {
				fg: (_color: string, text: string) => text,
				bg: (_color: string, text: string) => text,
			},
		},
		sessionManager: {
			getBranch: () => [{
				type: "message",
				id: "request-result",
				message: {
					role: "toolResult",
					toolName: "request_user_input",
					toolCallId: "request-1",
					details: {
						context: "The project has two database options.",
						question: "Which database should I use?",
						recommendedAnswer: "PostgreSQL",
						rationale: "It fits the existing deployment platform.",
					},
				},
			}],
			getChildren: () => [],
		},
	});

	assert.deepEqual(widgets, [["agent-status", ["Needs input · 14:06:09 -- 13:09:2026"]]]);

	await input({ type: "input", source: "interactive", text: "Use PostgreSQL." }, {});
	assert.deepEqual(fake.entries, [{
		customType: "agent-status-input-resolution",
		data: { toolCallId: "request-1" },
	}]);
});

test("resuming does not restore a request resolved by its direct child user message", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	const sessionStart = fake.getHandler("session_start");
	const input = fake.getHandler("input");
	assert.ok(sessionStart);
	assert.ok(input);

	const requestResult = {
		type: "message",
		id: "request-result",
		parentId: null,
		message: {
			role: "toolResult",
			toolName: "request_user_input",
			toolCallId: "request-1",
			details: {
				context: "The project has two database options.",
				question: "Which database should I use?",
				recommendedAnswer: "PostgreSQL",
				rationale: "It fits the existing deployment platform.",
			},
		},
	};
	const resolution = {
		type: "custom",
		id: "resolution",
		parentId: "request-result",
		customType: "agent-status-input-resolution",
		data: { toolCallId: "request-1" },
	};
	const userResponse = {
		type: "message",
		id: "user-response",
		parentId: "resolution",
		message: { role: "user", content: "Use PostgreSQL." },
	};
	await sessionStart({ type: "session_start", reason: "resume" }, {
		mode: "tui",
		ui: {
			setWidget: () => {},
			theme: { fg: (_color: string, text: string) => text },
		},
		sessionManager: {
			getBranch: () => [requestResult, resolution, userResponse],
			getChildren: (id: string) => id === "resolution" ? [userResponse] : [],
		},
	});

	await input({ type: "input", source: "interactive", text: "Continue." }, {});
	assert.deepEqual(fake.entries, []);
});

test("request_user_input terminates the agent after recording the request", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);

	const result = await tool.execute("request-1", {
		context: "The project has two database options.",
		question: "Which database should I use?",
		recommendedAnswer: "PostgreSQL",
		rationale: "It fits the existing deployment platform.",
	});

	assert.deepEqual(result, {
		content: [{ type: "text", text: "Waiting for user input." }],
		details: {
			context: "The project has two database options.",
			question: "Which database should I use?",
			recommendedAnswer: "PostgreSQL",
			rationale: "It fits the existing deployment platform.",
			toolCallId: "request-1",
		},
		terminate: true,
	});
});

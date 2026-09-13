import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

test("request_user_input renders all decision fields in the transcript", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	assert.ok(tool);

	const renderedTool = tool as unknown as {
		renderResult: (
			result: { details: Record<string, string>; content: [] },
			options: Record<string, never>,
			theme: { fg: (_color: string, text: string) => string },
		) => { render: (width: number) => string[] };
	};
	const component = renderedTool.renderResult({
		content: [],
		details: {
			context: "The project has two database options.",
			question: "Which database should I use?",
			recommendedAnswer: "PostgreSQL",
			rationale: "It fits the existing deployment platform.",
			toolCallId: "request-1",
		},
	}, {}, { fg: (_color, text) => text });

	assert.deepEqual(component.render(100).map((line) => line.trimEnd()), [
		"Context",
		"The project has two database options.",
		"Question",
		"Which database should I use?",
		"Recommended answer",
		"PostgreSQL",
		"Rationale",
		"It fits the existing deployment platform.",
	]);
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

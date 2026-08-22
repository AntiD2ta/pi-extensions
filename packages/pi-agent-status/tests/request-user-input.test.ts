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
		getHandler: (event: string) => handlers.get(event),
		getTool: () => tool,
	};
}

async function startSession(fake: ReturnType<typeof createFakePi>, mode: string) {
	const sessionStart = fake.getHandler("session_start");
	assert.ok(sessionStart);
	await sessionStart({ type: "session_start", reason: "startup" }, {
		mode,
		sessionManager: { getBranch: () => [] },
	});
}

test("request_user_input registers only for TUI sessions", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	assert.equal(fake.getTool(), undefined);

	await startSession(fake, "print");
	assert.equal(fake.getTool(), undefined);

	await startSession(fake, "tui");
	assert.ok(fake.getTool());
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

test("the next agent run clears the needs-input status", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const agentStart = fake.getHandler("agent_start");
	assert.ok(agentStart);

	const statuses: Array<[string, string | undefined]> = [];
	await agentStart({ type: "agent_start" }, {
		ui: { setStatus: (key: string, value: string | undefined) => statuses.push([key, value]) },
	});

	assert.deepEqual(statuses, [["agent-status", undefined]]);
});

test("a pending input request suppresses completion at settlement", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	await startSession(fake, "tui");
	const tool = fake.getTool();
	const settled = fake.getHandler("agent_settled");
	assert.ok(tool);
	assert.ok(settled);

	await tool.execute("request-1", {
		context: "The project has two database options.",
		question: "Which database should I use?",
		recommendedAnswer: "PostgreSQL",
		rationale: "It fits the existing deployment platform.",
	});
	const statuses: Array<[string, string | undefined]> = [];
	await settled({ type: "agent_settled" }, {
		ui: { setStatus: (key: string, value: string | undefined) => statuses.push([key, value]) },
	});

	assert.deepEqual(statuses, [["agent-status", "Needs input"]]);
});

test("resuming restores an unanswered input request", async () => {
	const fake = createFakePi();
	extension(fake.pi);
	const sessionStart = fake.getHandler("session_start");
	const input = fake.getHandler("input");
	assert.ok(sessionStart);
	assert.ok(input);
	const statuses: Array<[string, string | undefined]> = [];

	await sessionStart({ type: "session_start", reason: "resume" }, {
		mode: "tui",
		ui: { setStatus: (key: string, value: string | undefined) => statuses.push([key, value]) },
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

	assert.deepEqual(statuses, [["agent-status", "Needs input"]]);

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

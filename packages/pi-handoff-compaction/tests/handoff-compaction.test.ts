import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { requiredHandoffHeadings } from "../handoff-headings.ts";
import handoffCompaction from "../index.ts";

function handoffDocument() {
	return requiredHandoffHeadings.map((heading) => `## ${heading}\n\ncontent`).join("\n\n");
}

function orchestrationId(data: unknown): string {
	if (typeof data !== "object" || data === null || !("orchestrationId" in data)) assert.fail("coordination event has no orchestration ID");
	const id = data.orchestrationId;
	assert.equal(typeof id, "string");
	assert.ok(id.trim());
	return id;
}

test("manual compaction writes a handoff before replacing context", async (t) => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["read", "write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	let handoffPath: string | undefined;
	let compaction: { onComplete?: () => void } | undefined;
	const ctx = {
		compact(options: { onComplete?: () => void }) { compaction = options; },
		sessionManager: { getLeafId: () => "handoff-boundary" },
	};
	t.after(() => { if (handoffPath) rmSync(handoffPath, { force: true }); });

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	const toolResult = handlers.get("tool_result");
	const settled = handlers.get("agent_settled");
	assert.ok(beforeCompact);
	assert.ok(compactFailed);
	assert.ok(toolResult);
	assert.ok(settled);

	const first = await beforeCompact({
		reason: "manual",
		branchEntries: [{ type: "message", message: { role: "user", content: "Initial request" } }],
		customInstructions: "Keep the API stable",
	} as never, ctx as never);
	assert.deepEqual(first, { cancel: true });
	await compactFailed({ reason: "manual", aborted: true } as never, ctx as never);
	assert.equal(messages.length, 1);
	assert.match(messages[0] ?? "", /## Initial prompt\n\nInitial request/);
	assert.match(messages[0] ?? "", /## Optional focus\n\nKeep the API stable/);
	handoffPath = messages[0]?.match(/^.*\n\n## Handoff path\n\n(.+)$/m)?.[1];
	assert.ok(handoffPath);
	writeFileSync(handoffPath, handoffDocument().replaceAll("\n", "\r\n"));
	await toolResult({ toolName: "write", input: { path: handoffPath }, isError: false } as never, ctx as never);
	await settled({} as never, ctx as never);

	assert.ok(compaction);
	const automatic = await beforeCompact({ reason: "threshold", preparation: { tokensBefore: 42 } } as never, ctx as never);
	assert.deepEqual(automatic, { cancel: true });
	const replacement = await beforeCompact({
		reason: "manual",
		preparation: { tokensBefore: 42 },
	} as never, ctx as never);
	assert.deepEqual(replacement, {
		compaction: {
			summary: "The prior task state was externalized. Follow the next user message.",
			firstKeptEntryId: "handoff-boundary",
			tokensBefore: 42,
		},
	});
	compaction.onComplete?.();
	assert.equal(messages.at(-1), `Read and follow ${handoffPath}`);
	assert.match(readFileSync(handoffPath, "utf8"), /^## Goal and constraints/m);
});

test("handoff compaction fails after a write to another path", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
		compact() { assert.fail("must not compact after a write to another path"); },
		sessionManager: { getLeafId: () => "handoff-boundary" },
	};

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	const toolResult = handlers.get("tool_result");
	const settled = handlers.get("agent_settled");
	assert.ok(beforeCompact);
	assert.ok(compactFailed);
	assert.ok(toolResult);
	assert.ok(settled);

	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	await compactFailed({ reason: "manual", aborted: true } as never, ctx as never);
	await toolResult({ toolName: "write", input: { path: "/tmp/not-the-handoff.md" }, isError: false } as never, ctx as never);
	await settled({} as never, ctx as never);

	assert.deepEqual(notifications, [{
		message: "Handoff compaction failed before context replacement: the handoff file was not written successfully. The conversation was not compacted.",
		type: "error",
	}]);
	assert.equal(messages.length, 1);
});

test("handoff compaction fails after a failed write", async (t) => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	let compactCalls = 0;
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: { notify() {} },
		compact() { compactCalls++; },
		sessionManager: { getLeafId: () => "handoff-boundary" },
	};
	let handoffPath: string | undefined;
	t.after(() => { if (handoffPath) rmSync(handoffPath, { force: true }); });

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	const toolResult = handlers.get("tool_result");
	const settled = handlers.get("agent_settled");
	assert.ok(beforeCompact);
	assert.ok(compactFailed);
	assert.ok(toolResult);
	assert.ok(settled);

	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	await compactFailed({ reason: "manual", aborted: true } as never, ctx as never);
	handoffPath = messages[0]?.match(/^.*\n\n## Handoff path\n\n(.+)$/m)?.[1];
	assert.ok(handoffPath);
	writeFileSync(handoffPath, handoffDocument());
	await toolResult({ toolName: "write", input: { path: handoffPath }, isError: true } as never, ctx as never);
	await settled({} as never, ctx as never);

	assert.equal(compactCalls, 0);
});

test("handoff compaction fails when required headings are empty", async (t) => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
		compact() { assert.fail("must not compact an invalid handoff"); },
		sessionManager: { getLeafId: () => "handoff-boundary" },
	};
	let handoffPath: string | undefined;
	t.after(() => { if (handoffPath) rmSync(handoffPath, { force: true }); });

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	const toolResult = handlers.get("tool_result");
	const settled = handlers.get("agent_settled");
	assert.ok(beforeCompact);
	assert.ok(compactFailed);
	assert.ok(toolResult);
	assert.ok(settled);

	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	await compactFailed({ reason: "manual", aborted: true } as never, ctx as never);
	handoffPath = messages[0]?.match(/^.*\n\n## Handoff path\n\n(.+)$/m)?.[1];
	assert.ok(handoffPath);
	writeFileSync(handoffPath, requiredHandoffHeadings.map((heading) => (
		heading === "Current state" ? `## ${heading}\n\n## Extra` : `## ${heading}\n\ncontent`
	)).join("\n\n"));
	await toolResult({ toolName: "write", input: { path: handoffPath }, isError: false } as never, ctx as never);
	await settled({} as never, ctx as never);

	assert.deepEqual(notifications, [{
		message: "Handoff compaction failed before context replacement: the handoff file is invalid. The conversation was not compacted.",
		type: "error",
	}]);
	assert.equal(messages.length, 1);
});

test("handoff compaction fails after an interrupted handoff turn", async (t) => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	let compactCalls = 0;
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
		compact() { compactCalls++; },
		sessionManager: { getLeafId: () => "handoff-boundary" },
	};
	let handoffPath: string | undefined;
	t.after(() => { if (handoffPath) rmSync(handoffPath, { force: true }); });

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	const toolResult = handlers.get("tool_result");
	const agentEnd = handlers.get("agent_end");
	const settled = handlers.get("agent_settled");
	assert.ok(beforeCompact);
	assert.ok(compactFailed);
	assert.ok(toolResult);
	assert.ok(settled);

	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	await compactFailed({ reason: "manual", aborted: true } as never, ctx as never);
	handoffPath = messages[0]?.match(/^.*\n\n## Handoff path\n\n(.+)$/m)?.[1];
	assert.ok(handoffPath);
	writeFileSync(handoffPath, handoffDocument());
	await toolResult({ toolName: "write", input: { path: handoffPath }, isError: false } as never, ctx as never);
	await agentEnd?.({ messages: [{ role: "assistant", stopReason: "aborted" }] } as never, ctx as never);
	await settled({} as never, ctx as never);

	assert.equal(compactCalls, 0);
	assert.deepEqual(notifications, [{
		message: "Handoff compaction failed before context replacement: the handoff turn was aborted. The conversation was not compacted.",
		type: "error",
	}]);
});

test("handoff compaction does not replace context before settlement", async (t) => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	let compactCalls = 0;
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		compact() { compactCalls++; },
		sessionManager: { getLeafId: () => "handoff-boundary" },
	};
	let handoffPath: string | undefined;
	t.after(() => { if (handoffPath) rmSync(handoffPath, { force: true }); });

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	const toolResult = handlers.get("tool_result");
	const agentEnd = handlers.get("agent_end");
	assert.ok(beforeCompact);
	assert.ok(compactFailed);
	assert.ok(toolResult);

	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	await compactFailed({ reason: "manual", aborted: true } as never, ctx as never);
	handoffPath = messages[0]?.match(/^.*\n\n## Handoff path\n\n(.+)$/m)?.[1];
	assert.ok(handoffPath);
	writeFileSync(handoffPath, handoffDocument());
	await toolResult({ toolName: "write", input: { path: handoffPath }, isError: false } as never, ctx as never);
	await agentEnd?.({ messages: [{ role: "assistant", stopReason: "stop" }] } as never, ctx as never);

	assert.equal(compactCalls, 0);
	assert.deepEqual(await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never), { cancel: true });
});

test("handoff compaction invalidates pending work on session shutdown", async () => {
	for (const reason of ["quit", "reload", "new", "resume", "fork"] as const) {
		const handlers = new Map<string, (event: never, ctx: never) => unknown>();
		const messages: string[] = [];
		const notifications: Array<{ message: string; type?: string }> = [];
		let compactCalls = 0;
		const pi = {
			on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
			getActiveTools: () => ["write"],
			sendUserMessage(message: string) { messages.push(message); },
			appendEntry() {},
		} as unknown as ExtensionAPI;
		const ctx = {
			hasUI: true,
			ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
			compact() { compactCalls++; },
			sessionManager: { getLeafId: () => "handoff-boundary" },
		};

		handoffCompaction(pi);
		const beforeCompact = handlers.get("session_before_compact");
		const compactFailed = handlers.get("session_compact_failed");
		const toolResult = handlers.get("tool_result");
		const shutdown = handlers.get("session_shutdown");
		const settled = handlers.get("agent_settled");
		assert.ok(beforeCompact);
		assert.ok(compactFailed);
		assert.ok(toolResult);
		assert.ok(settled);

		await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
		await compactFailed({ reason: "manual", aborted: true } as never, ctx as never);
		const handoffPath = messages[0]?.match(/^.*\n\n## Handoff path\n\n(.+)$/m)?.[1];
		assert.ok(handoffPath);
		writeFileSync(handoffPath, handoffDocument());
		await toolResult({ toolName: "write", input: { path: handoffPath }, isError: false } as never, ctx as never);
		await shutdown?.({ reason } as never, ctx as never);
		await settled({} as never, ctx as never);
		rmSync(handoffPath, { force: true });

		const failureReason = {
			quit: "the session was shut down",
			reload: "the session was reloaded",
			new: "the session was replaced",
			resume: "the session was resumed",
			fork: "the session was forked",
		}[reason];
		assert.equal(compactCalls, 0, reason);
		assert.deepEqual(notifications, [{
			message: `Handoff compaction failed before context replacement: ${failureReason}. The conversation was not compacted.`,
			type: "error",
		}], reason);
	}
});

test("handoff compaction blocks competing compactions while generation is pending", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
	} as unknown as ExtensionAPI;

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	assert.ok(beforeCompact);

	assert.deepEqual(await beforeCompact({ reason: "manual", branchEntries: [] } as never, {} as never), { cancel: true });
	assert.deepEqual(await beforeCompact({ reason: "threshold", branchEntries: [] } as never, {} as never), { cancel: true });
});

test("handoff compaction reports an inactive write tool before generation", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const notifications: Array<{ message: string; type?: string }> = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["read"],
		getAllTools: () => [{ name: "write" }],
		sendUserMessage() { assert.fail("must not generate a handoff without an active write tool"); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
	};

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	assert.ok(beforeCompact);

	const result = await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	const message = "Handoff compaction failed before context replacement: the write tool is inactive. The conversation was not compacted.";
	assert.deepEqual(result, { cancel: true });
	assert.deepEqual(notifications, [{ message, type: "error" }]);
});

test("handoff compaction reports an unavailable write tool before generation", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const notifications: Array<{ message: string; type?: string }> = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["read"],
		getAllTools: () => [],
		sendUserMessage() { assert.fail("must not generate a handoff without a write tool"); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
	};

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	assert.ok(beforeCompact);

	const result = await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	const message = "Handoff compaction failed before context replacement: the write tool is unavailable. The conversation was not compacted.";
	assert.deepEqual(result, { cancel: true });
	assert.deepEqual(notifications, [{ message, type: "error" }]);
});

test("handoff compaction fails when its cancellation is not aborted", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const notifications: Array<{ message: string; type?: string }> = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage() { assert.fail("must not generate a handoff after a failed cancellation"); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
	};

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	assert.ok(beforeCompact);
	assert.ok(compactFailed);

	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	await compactFailed({ reason: "manual", aborted: false } as never, ctx as never);
	const message = "Handoff compaction failed before context replacement: the original compaction was not aborted. The conversation was not compacted.";
	assert.deepEqual(notifications, [{ message, type: "error" }]);
});

test("handoff compaction writes failures to stderr without a UI", async (t) => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const errors: string[] = [];
	const originalError = console.error;
	console.error = (message: unknown) => { errors.push(String(message)); };
	t.after(() => { console.error = originalError; });
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => [],
		getAllTools: () => [],
		sendUserMessage() { assert.fail("must not generate a handoff without a write tool"); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: false,
		mode: "json",
		ui: { notify() { assert.fail("must not notify without a UI"); } },
	};

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	assert.ok(beforeCompact);

	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	const message = "Handoff compaction failed before context replacement: the write tool is unavailable. The conversation was not compacted.";
	assert.deepEqual(errors, [message]);
});

test("automatic threshold starts one handoff at 90 percent of the active context window", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	let compactCalls = 0;
	let tokens = 179_999;
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		model: { contextWindow: 200_000 },
		getContextUsage: () => ({ tokens, contextWindow: 200_000, percent: (tokens / 200_000) * 100 }),
		compact() { compactCalls++; },
	};

	handoffCompaction(pi);
	const turnEnd = handlers.get("turn_end");
	assert.ok(turnEnd);

	await turnEnd({} as never, ctx as never);
	assert.equal(compactCalls, 0);

	tokens = 180_000;
	await turnEnd({} as never, ctx as never);
	await turnEnd({} as never, ctx as never);
	assert.equal(compactCalls, 1);
	assert.equal(messages.length, 0);
});

test("automatic handoff reports a compaction setup failure once", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const notifications: Array<{ message: string; type?: string }> = [];
	let compactCalls = 0;
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		model: { contextWindow: 200_000 },
		getContextUsage: () => ({ tokens: 180_000, contextWindow: 200_000, percent: 90 }),
		hasUI: true,
		ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
		compact(options?: { onError?: (error: Error) => void }) {
			compactCalls++;
			options?.onError?.(new Error("automatic compaction could not start"));
		},
	};

	handoffCompaction(pi);
	const turnEnd = handlers.get("turn_end");
	assert.ok(turnEnd);

	await turnEnd({} as never, ctx as never);
	await turnEnd({} as never, ctx as never);

	assert.equal(compactCalls, 1);
	assert.deepEqual(notifications, [{
		message: "Handoff compaction failed before context replacement: the automatic compaction could not be started. The conversation was not compacted.",
		type: "error",
	}]);
});

test("stale automatic compaction errors do not fail a later attempt", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const notifications: Array<{ message: string; type?: string }> = [];
	const onErrors: Array<(error: Error) => void> = [];
	let tokens = 180_000;
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		model: { contextWindow: 200_000 },
		getContextUsage: () => ({ tokens, contextWindow: 200_000, percent: (tokens / 200_000) * 100 }),
		hasUI: true,
		ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
		compact(options?: { onError?: (error: Error) => void }) {
			assert.ok(options?.onError);
			onErrors.push(options.onError);
		},
	};

	handoffCompaction(pi);
	const turnEnd = handlers.get("turn_end");
	assert.ok(turnEnd);

	await turnEnd({} as never, ctx as never);
	onErrors[0]?.(new Error("first failure"));
	tokens = 0;
	await turnEnd({} as never, ctx as never);
	tokens = 180_000;
	await turnEnd({} as never, ctx as never);
	onErrors[0]?.(new Error("stale first failure"));

	assert.equal(onErrors.length, 2);
	assert.equal(notifications.length, 1);
});

test("automatic threshold uses 90 percent for small context windows", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	let compactCalls = 0;
	let tokens = 899;
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		model: { contextWindow: 1_000 },
		getContextUsage: () => ({ tokens, contextWindow: 1_000, percent: (tokens / 1_000) * 100 }),
		compact() { compactCalls++; },
	};

	handoffCompaction(pi);
	const turnEnd = handlers.get("turn_end");
	assert.ok(turnEnd);

	await turnEnd({} as never, ctx as never);
	assert.equal(compactCalls, 0);

	tokens = 900;
	await turnEnd({} as never, ctx as never);
	assert.equal(compactCalls, 1);
});

test("automatic threshold caps large context windows at 275,000 tokens", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	let compactCalls = 0;
	let tokens = 274_999;
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		model: { contextWindow: 400_000 },
		getContextUsage: () => ({ tokens, contextWindow: 400_000, percent: (tokens / 400_000) * 100 }),
		compact() { compactCalls++; },
	};

	handoffCompaction(pi);
	const turnEnd = handlers.get("turn_end");
	assert.ok(turnEnd);

	await turnEnd({} as never, ctx as never);
	assert.equal(compactCalls, 0);

	tokens = 275_000;
	await turnEnd({} as never, ctx as never);
	assert.equal(compactCalls, 1);
});

test("an earlier native threshold starts the handoff immediately", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
	} as unknown as ExtensionAPI;

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	assert.ok(beforeCompact);
	assert.ok(compactFailed);

	const result = await beforeCompact({ reason: "threshold", branchEntries: [] } as never, {} as never);
	assert.deepEqual(result, { cancel: true });
	await compactFailed({ reason: "threshold", aborted: true } as never, {} as never);
	assert.equal(messages.length, 1);
});

test("a model switch recalculates later automatic checks without restarting handoff", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	let compactCalls = 0;
	let model = { contextWindow: 200_000 };
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		get model() { return model; },
		getContextUsage: () => ({ tokens: 100_000, contextWindow: model.contextWindow, percent: 50 }),
		compact() { compactCalls++; },
	};

	handoffCompaction(pi);
	const turnEnd = handlers.get("turn_end");
	assert.ok(turnEnd);

	await turnEnd({} as never, ctx as never);
	assert.equal(compactCalls, 0);

	model = { contextWindow: 100_000 };
	await turnEnd({} as never, ctx as never);
	await turnEnd({} as never, ctx as never);
	assert.equal(compactCalls, 1);
});

test("automatic handoff follows the manual handoff workflow through continuation", async (t) => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	const compactions: Array<{ onComplete?: () => void }> = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		model: { contextWindow: 200_000 },
		getContextUsage: () => ({ tokens: 180_000, contextWindow: 200_000, percent: 90 }),
		compact(options: { onComplete?: () => void }) { compactions.push(options); },
		sessionManager: { getLeafId: () => "handoff-boundary" },
	};
	let handoffPath: string | undefined;
	t.after(() => { if (handoffPath) rmSync(handoffPath, { force: true }); });

	handoffCompaction(pi);
	const turnEnd = handlers.get("turn_end");
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	const toolResult = handlers.get("tool_result");
	const settled = handlers.get("agent_settled");
	assert.ok(turnEnd);
	assert.ok(beforeCompact);
	assert.ok(compactFailed);
	assert.ok(toolResult);
	assert.ok(settled);

	await turnEnd({} as never, ctx as never);
	assert.equal(compactions.length, 1);
	assert.deepEqual(await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never), { cancel: true });
	await compactFailed({ reason: "manual", aborted: true } as never, ctx as never);
	handoffPath = messages[0]?.match(/^.*\n\n## Handoff path\n\n(.+)$/m)?.[1];
	assert.ok(handoffPath);
	writeFileSync(handoffPath, handoffDocument());
	await toolResult({ toolName: "write", input: { path: handoffPath }, isError: false } as never, ctx as never);
	await settled({} as never, ctx as never);

	assert.equal(compactions.length, 2);
	assert.deepEqual(await beforeCompact({ reason: "manual", preparation: { tokensBefore: 42 } } as never, ctx as never), {
		compaction: {
			summary: "The prior task state was externalized. Follow the next user message.",
			firstKeptEntryId: "handoff-boundary",
			tokensBefore: 42,
		},
	});
	compactions[1]?.onComplete?.();
	assert.equal(messages.at(-1), `Read and follow ${handoffPath}`);
});

test("failed automatic handoff attempts are not retried by duplicate triggers", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	let compactCalls = 0;
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		model: { contextWindow: 200_000 },
		getContextUsage: () => ({ tokens: 180_000, contextWindow: 200_000, percent: 90 }),
		compact() { compactCalls++; },
		hasUI: true,
		ui: { notify() {} },
	};

	handoffCompaction(pi);
	const turnEnd = handlers.get("turn_end");
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	assert.ok(turnEnd);
	assert.ok(beforeCompact);
	assert.ok(compactFailed);

	await turnEnd({} as never, ctx as never);
	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	await compactFailed({ reason: "manual", aborted: false } as never, ctx as never);
	await turnEnd({} as never, ctx as never);
	assert.equal(compactCalls, 1);

	await beforeCompact({ reason: "threshold", branchEntries: [] } as never, ctx as never);
	await compactFailed({ reason: "threshold", aborted: true } as never, ctx as never);
	assert.equal(messages.length, 0);
});

test("model switches do not reset an active automatic handoff attempt", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	let compactCalls = 0;
	let model = { contextWindow: 200_000 };
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		get model() { return model; },
		getContextUsage: () => ({ tokens: 180_000, contextWindow: model.contextWindow, percent: 90 }),
		compact() { compactCalls++; },
		hasUI: true,
		ui: { notify() {} },
	};

	handoffCompaction(pi);
	const turnEnd = handlers.get("turn_end");
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	assert.ok(turnEnd);
	assert.ok(beforeCompact);
	assert.ok(compactFailed);

	await turnEnd({} as never, ctx as never);
	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	model = { contextWindow: 400_000 };
	await turnEnd({} as never, ctx as never);
	await compactFailed({ reason: "manual", aborted: false } as never, ctx as never);
	model = { contextWindow: 200_000 };
	await turnEnd({} as never, ctx as never);
	assert.equal(compactCalls, 1);
});

test("provider overflow before handoff generation leaves the context unchanged", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
	};

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	assert.ok(beforeCompact);

	const result = await beforeCompact({ reason: "overflow", branchEntries: [] } as never, ctx as never);
	assert.deepEqual(result, { cancel: true });
	assert.equal(messages.length, 0);
	assert.deepEqual(notifications, [{
		message: "Handoff compaction failed before context replacement: the context overflowed before the handoff could begin. The conversation was not compacted.",
		type: "error",
	}]);
});

test("provider overflow during handoff generation fails the active orchestration", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const notifications: Array<{ message: string; type?: string }> = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		appendEntry() {},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
	};

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	assert.ok(beforeCompact);

	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	const result = await beforeCompact({ reason: "overflow", branchEntries: [] } as never, ctx as never);

	assert.deepEqual(result, { cancel: true });
	assert.deepEqual(notifications, [{
		message: "Handoff compaction failed before context replacement: the context overflowed before the handoff could begin. The conversation was not compacted.",
		type: "error",
	}]);
});

test("handoff holds Powerline until the continuation turn settles", async (t) => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const events: Array<{ channel: string; data: unknown }> = [];
	const messages: string[] = [];
	let handoffPath: string | undefined;
	let compaction: { onComplete?: () => void } | undefined;
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() {},
		events: { emit(channel: string, data: unknown) { events.push({ channel, data }); } },
	} as unknown as ExtensionAPI;
	const ctx = {
		compact(options: { onComplete?: () => void }) { compaction = options; },
		sessionManager: { getLeafId: () => "handoff-boundary", getSessionId: () => "session-1" },
	};
	t.after(() => { if (handoffPath) rmSync(handoffPath, { force: true }); });

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	const toolResult = handlers.get("tool_result");
	const beforeAgentStart = handlers.get("before_agent_start");
	const settled = handlers.get("agent_settled");
	assert.ok(beforeCompact);
	assert.ok(compactFailed);
	assert.ok(toolResult);
	assert.ok(beforeAgentStart);
	assert.ok(settled);

	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	assert.equal(events.length, 1);
	assert.equal(events[0]?.channel, "pi-handoff-compaction:v1");
	const holdOrchestrationId = orchestrationId(events[0]?.data);
	assert.deepEqual(events[0]?.data, {
		version: 1,
		kind: "hold",
		sessionId: "session-1",
		orchestrationId: holdOrchestrationId,
	});

	await compactFailed({ reason: "manual", aborted: true } as never, ctx as never);
	handoffPath = messages[0]?.match(/^.*\n\n## Handoff path\n\n(.+)$/m)?.[1];
	assert.ok(handoffPath);
	writeFileSync(handoffPath, handoffDocument());
	await toolResult({ toolName: "write", input: { path: handoffPath }, isError: false } as never, ctx as never);
	await settled({} as never, ctx as never);
	compaction?.onComplete?.();
	const continuation = `Read and follow ${handoffPath}`;
	assert.equal(messages.at(-1), continuation);
	assert.equal(events.length, 1);
	await beforeAgentStart({ prompt: continuation } as never, ctx as never);
	assert.equal(events.length, 1);
	await settled({} as never, ctx as never);
	assert.deepEqual(events[1], {
		channel: "pi-handoff-compaction:v1",
		data: {
			version: 1,
			kind: "release",
			sessionId: "session-1",
			orchestrationId: holdOrchestrationId,
		},
	});
});

test("handoff rejects ordinary input while allowing extension-generated prompts", async () => {
	for (const [mode, source] of [
		["tui", "interactive"],
		["rpc", "rpc"],
		["json", "rpc"],
		["print", "interactive"],
	] as const) {
		const handlers = new Map<string, (event: never, ctx: never) => unknown>();
		const notifications: Array<{ message: string; type?: string }> = [];
		const errors: string[] = [];
		const originalError = console.error;
		console.error = (message: unknown) => { errors.push(String(message)); };
		try {
			const pi = {
				on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
				getActiveTools: () => ["write"],
				appendEntry() {},
			} as unknown as ExtensionAPI;
			const ctx = {
				mode,
				hasUI: mode === "tui" || mode === "rpc",
				ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
			};

			handoffCompaction(pi);
			const beforeCompact = handlers.get("session_before_compact");
			const input = handlers.get("input");
			assert.ok(beforeCompact, mode);
			assert.ok(input, mode);
			await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);

			assert.deepEqual(await input({ source, text: "Do not interrupt the handoff." } as never, ctx as never), { action: "handled" }, mode);
			assert.deepEqual(
				await input({ source: "extension", text: "Read and follow /tmp/pi-handoff.md" } as never, ctx as never),
				{ action: "continue" },
				mode,
			);
			const message = "Handoff compaction is in progress. Wait for the continuation prompt to finish.";
			if (ctx.hasUI) assert.deepEqual(notifications, [{ message, type: "error" }], mode);
			else assert.deepEqual(errors, [message], mode);
		} finally {
			console.error = originalError;
		}
	}
});

test("handoff reports a failed orchestration to Powerline", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const events: Array<{ channel: string; data: unknown }> = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		appendEntry() {},
		events: { emit(channel: string, data: unknown) { events.push({ channel, data }); } },
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: { notify() {} },
		sessionManager: { getSessionId: () => "session-1" },
	};

	handoffCompaction(pi);
	const beforeCompact = handlers.get("session_before_compact");
	const compactFailed = handlers.get("session_compact_failed");
	assert.ok(beforeCompact);
	assert.ok(compactFailed);

	await beforeCompact({ reason: "manual", branchEntries: [] } as never, ctx as never);
	const holdOrchestrationId = orchestrationId(events[0]?.data);
	await compactFailed({ reason: "manual", aborted: false } as never, ctx as never);
	assert.deepEqual(events[1], {
		channel: "pi-handoff-compaction:v1",
		data: {
			version: 1,
			kind: "failure",
			sessionId: "session-1",
			orchestrationId: holdOrchestrationId,
			reason: "the original compaction was not aborted",
		},
	});
});

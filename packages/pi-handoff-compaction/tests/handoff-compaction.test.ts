import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { requiredHandoffHeadings } from "../handoff-headings.ts";
import handoffCompaction from "../index.ts";

function handoffDocument() {
	return requiredHandoffHeadings.map((heading) => `## ${heading}\n\ncontent`).join("\n\n");
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
	assert.deepEqual(await beforeCompact({ reason: "overflow", branchEntries: [] } as never, {} as never), { cancel: true });
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

import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import handoffCompaction from "../index.ts";

const headings = [
	"Goal and constraints",
	"Initial prompt",
	"Current state",
	"Completed work",
	"Incomplete work",
	"Decisions and reasons",
	"Concrete next steps",
	"Suggested skills",
	"References",
];

function handoffDocument() {
	return headings.map((heading) => `## ${heading}\n\ncontent`).join("\n\n");
}

test("manual compaction writes a handoff before replacing context", async (t) => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	const entries: Array<{ type: string; data?: unknown }> = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["read", "write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry(_type: string, data: unknown) { entries.push({ type: "custom", data }); },
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
	writeFileSync(handoffPath, handoffDocument());
	await toolResult({ toolName: "write", input: { path: handoffPath }, isError: false } as never, ctx as never);
	await settled({} as never, ctx as never);

	assert.equal(entries.length, 1);
	assert.deepEqual(entries[0]?.data, { handoffPath });
	assert.ok(compaction);
	const automatic = await beforeCompact({ reason: "threshold", preparation: { tokensBefore: 42 } } as never, ctx as never);
	assert.equal(automatic, undefined);
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

test("handoff compaction ignores writes to another path", async () => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	const entries: unknown[] = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry(...args: unknown[]) { entries.push(args); },
	} as unknown as ExtensionAPI;
	const ctx = {
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

	assert.equal(entries.length, 0);
	assert.equal(messages.length, 1);
});

test("handoff compaction requires every required heading", async (t) => {
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const messages: string[] = [];
	const pi = {
		on(event: string, handler: (event: never, ctx: never) => unknown) { handlers.set(event, handler); },
		getActiveTools: () => ["write"],
		sendUserMessage(message: string) { messages.push(message); },
		appendEntry() { assert.fail("must not append a boundary for an invalid handoff"); },
	} as unknown as ExtensionAPI;
	const ctx = {
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
	writeFileSync(handoffPath, "## Goal and constraints\n");
	await toolResult({ toolName: "write", input: { path: handoffPath }, isError: false } as never, ctx as never);
	await settled({} as never, ctx as never);

	assert.equal(messages.length, 1);
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import queueExtension from "../queue.ts";
import { QueueStore, currentQueueContext, getQueueStorePaths } from "../queue-store.ts";
import { QueueDelivery } from "../queue-delivery.ts";

async function withStore(fn: (store: QueueStore, directory: string) => void | Promise<void>): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), "visual-profile-queue-"));
	try {
		const store = new QueueStore({
			inboxPath: join(directory, "inbox.jsonl"),
			aliasesPath: join(directory, "aliases.json"),
			ownerPath: join(directory, "owner"),
		});
		assert.equal(store.acquireOwner("owner-a"), true);
		await fn(store, directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("queue uses its own JSONL namespace and skips malformed records", () => withStore((store, directory) => {
	writeFileSync(join(directory, "inbox.jsonl"), [
		JSON.stringify({ id: "one", text: "first", createdAt: 1, updatedAt: 1, source: { cwd: "/tmp/a" }, target: { kind: "global" }, intent: "follow-up", status: "queued" }),
		"not json",
		JSON.stringify({ id: "two", text: "second", createdAt: 2, updatedAt: 2, source: { cwd: "/tmp/a" }, target: { kind: "project", cwd: "/tmp/a" }, intent: "steer", status: "queued" }),
	].join("\n"));

	assert.deepEqual(store.activeItems(currentQueueContext("/tmp/a")).map((item) => item.id), ["one", "two"]);
}));

test("a second runtime remains read-only while an owner is active", () => withStore((store, directory) => {
	const second = new QueueStore({
		inboxPath: join(directory, "inbox.jsonl"),
		aliasesPath: join(directory, "aliases.json"),
		ownerPath: join(directory, "owner"),
	});
	assert.equal(second.acquireOwner("owner-b"), false);
	assert.match(second.ownerReason() ?? "", /owner-a/);
	assert.throws(() => second.add({ text: "must not write", source: { cwd: "/tmp/a" }, target: { kind: "global" }, intent: "follow-up" }), /read-only/);
	assert.equal(store.activeItems(currentQueueContext("/tmp/a")).length, 0);
}));

test("an active owner refreshes its lease before another runtime can recover it", () => withStore((store, directory) => {
	assert.equal(store.refreshOwner(100), true);
	const second = new QueueStore({
		inboxPath: join(directory, "inbox.jsonl"),
		aliasesPath: join(directory, "aliases.json"),
		ownerPath: join(directory, "owner"),
	});
	assert.equal(second.acquireOwner("owner-b", 30_050), false);
}));

test("an owner whose lease disappears becomes read-only", () => withStore((store, directory) => {
	rmSync(join(directory, "owner"), { recursive: true, force: true });
	assert.throws(() => store.add({ text: "must not write", source: { cwd: "/tmp/a" }, target: { kind: "global" }, intent: "follow-up" }), /owner lease is missing/);
}));

test("delivery remains delivering until Pi starts the matching user message", () => withStore((store) => {
	const item = store.add({ text: "deliver this", source: { cwd: "/tmp/a" }, target: { kind: "global" }, intent: "follow-up" });
	const sent: string[] = [];
	const delivery = new QueueDelivery(store, (text) => sent.push(text));

	delivery.deliver(item);
	assert.equal(store.get(item.id)?.status, "delivering");
	assert.deepEqual(sent, ["deliver this"]);
	assert.equal(delivery.observeUserMessage("different text"), false);
	assert.equal(store.get(item.id)?.status, "delivering");
	assert.equal(delivery.observeUserMessage("deliver this"), true);
	assert.equal(store.get(item.id)?.status, "sent");
}));

test("submission failure leaves the item recoverable", () => withStore((store) => {
	const item = store.add({ text: "deliver this", source: { cwd: "/tmp/a" }, target: { kind: "global" }, intent: "follow-up" });
	const delivery = new QueueDelivery(store, () => { throw new Error("offline"); });

	assert.equal(delivery.deliver(item), false);
	assert.equal(store.get(item.id)?.status, "failed");
	assert.equal(store.get(item.id)?.error, "offline");
}));

test("unconfirmed submission becomes queued with an observable error", async () => withStore(async (store) => {
	const item = store.add({ text: "deliver this", source: { cwd: "/tmp/a" }, target: { kind: "global" }, intent: "follow-up" });
	const delivery = new QueueDelivery(store, () => undefined, 10);

	assert.equal(delivery.deliver(item), true);
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(store.get(item.id)?.status, "queued");
	assert.equal(store.get(item.id)?.error, "Pi did not start queued message delivery");
}));

test("a manual compaction captures its message and waits for Pi to settle before delivery", async () => {
	const directory = mkdtempSync(join(tmpdir(), "visual-profile-queue-extension-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const handlers = new Map<string, (event: never, context: never) => unknown>();
	let editorFactory: unknown;
	let compacted = false;
	const sent: string[] = [];
	const pi = {
		on(event: string, handler: unknown) {
			handlers.set(event, handler as (event: never, context: never) => unknown);
		},
		sendUserMessage(text: string) {
			sent.push(text);
		},
	} as unknown as ExtensionAPI;
	const editor = {
		handleInput: (_data: string) => undefined,
		getExpandedText: () => "/compact continue after compaction",
		getText: () => "/compact continue after compaction",
		setText: () => undefined,
		addToHistory: () => undefined,
	};
	const context = {
		cwd: "/tmp/queue-extension",
		sessionManager: { getSessionId: () => "session-a" },
		ui: {
			setStatus: () => undefined,
			notify: () => undefined,
			getEditorComponent: () => () => editor,
			setEditorComponent: (factory: unknown) => { editorFactory = factory; },
		},
		isIdle: () => true,
		compact: () => { compacted = true; },
	};
	try {
		process.env.PI_CODING_AGENT_DIR = directory;
		queueExtension(pi);
		handlers.get("session_start")?.({} as never, context as never);

		assert.equal(typeof editorFactory, "function");
		const wrapped = (editorFactory as (tui: never, theme: never, keybindings: never) => typeof editor)(undefined as never, undefined as never, {
			matches: (_data: string, binding: string) => binding === "tui.input.submit",
		} as never);
		wrapped.handleInput("enter");

		const store = new QueueStore(getQueueStorePaths(directory));
		assert.equal(store.list()[0]?.text, "continue after compaction");
		assert.equal(store.list()[0]?.intent, "post-compact");
		assert.equal(compacted, true);
		handlers.get("session_compact")?.({ willRetry: false } as never, context as never);
		assert.deepEqual(sent, []);
		await new Promise((resolve) => setTimeout(resolve, 75));
		assert.deepEqual(sent, ["continue after compaction"]);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("a queue owner recovers persisted delivery before selecting the next item", () => withStore((store) => {
	const item = store.add({ text: "deliver this", source: { cwd: "/tmp/a" }, target: { kind: "global" }, intent: "follow-up" });
	store.update(item.id, { status: "delivering" });

	assert.equal(store.requeueDelivering("Pi did not confirm queued message delivery"), 1);
	assert.equal(store.get(item.id)?.status, "queued");
	assert.equal(store.get(item.id)?.error, "Pi did not confirm queued message delivery");
}));

test("a non-owner does not install queue capture or native status", () => {
	const directory = mkdtempSync(join(tmpdir(), "visual-profile-queue-two-owner-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const handlers = new Map<string, (event: never, context: never) => unknown>();
	let editorFactory: unknown;
	const statuses: unknown[] = [];
	const pi = {
		on(event: string, handler: unknown) {
			handlers.set(event, handler as (event: never, context: never) => unknown);
		},
		sendUserMessage: () => undefined,
	} as unknown as ExtensionAPI;
	const context = {
		cwd: "/tmp/queue-extension",
		sessionManager: { getSessionId: () => "session-b" },
		ui: {
			setStatus: (...status: unknown[]) => statuses.push(status),
			notify: () => undefined,
			getEditorComponent: () => undefined,
			setEditorComponent: (factory: unknown) => { editorFactory = factory; },
		},
		isIdle: () => true,
		compact: () => undefined,
	};
	try {
		process.env.PI_CODING_AGENT_DIR = directory;
		new QueueStore(getQueueStorePaths(directory)).acquireOwner("session-a");
		queueExtension(pi);
		handlers.get("session_start")?.({} as never, context as never);

		assert.equal(editorFactory, undefined);
		assert.deepEqual(statuses, []);
		assert.deepEqual(handlers.get("input")?.({ text: "/compact blocked" } as never, context as never), { action: "continue" });
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("an active lease operation prevents refresh or release from changing the owner", () => withStore((store, directory) => {
	mkdirSync(join(directory, "owner.lock"));
	writeFileSync(join(directory, "owner.lock", "lease.json"), JSON.stringify({ id: "lease-operation", createdAt: Date.now() }));

	assert.throws(() => store.refreshOwner(), /active queue lease operation/);
	assert.throws(() => store.releaseOwner(), /active queue lease operation/);
	assert.throws(() => new QueueStore({ inboxPath: join(directory, "inbox.jsonl"), aliasesPath: join(directory, "aliases.json"), ownerPath: join(directory, "owner") }).acquireOwner("owner-b"), /active queue lease operation/);
	rmSync(join(directory, "owner.lock"), { recursive: true, force: true });
	store.releaseOwner();
	assert.equal(new QueueStore({ inboxPath: join(directory, "inbox.jsonl"), aliasesPath: join(directory, "aliases.json"), ownerPath: join(directory, "owner") }).acquireOwner("owner-b"), true);
}));

test("a stale owner lock is recovered but an active operation lock is not stolen", () => withStore((store, directory) => {
	store.releaseOwner();
	mkdirSync(join(directory, "owner"));
	writeFileSync(join(directory, "owner", "lease.json"), JSON.stringify({ id: "dead", createdAt: 0 }));
	assert.equal(store.acquireOwner("owner-a", 30_001), true);

	mkdirSync(join(directory, "inbox.jsonl.lock"));
	writeFileSync(join(directory, "inbox.jsonl.lock", "lease.json"), JSON.stringify({ id: "writer", createdAt: Date.now() }));
	assert.throws(() => store.add({ text: "blocked", source: { cwd: "/tmp/a" }, target: { kind: "global" }, intent: "follow-up" }), /active queue write/);
	assert.equal(store.list().length, 0);
	rmSync(join(directory, "inbox.jsonl.lock"), { recursive: true, force: true });
	mkdirSync(join(directory, "inbox.jsonl.lock"));
	writeFileSync(join(directory, "inbox.jsonl.lock", "lease.json"), JSON.stringify({ id: "dead-writer", createdAt: 0 }));
	store.add({ text: "recovered", source: { cwd: "/tmp/a" }, target: { kind: "global" }, intent: "follow-up" });
	assert.equal(store.list().length, 1);
}));

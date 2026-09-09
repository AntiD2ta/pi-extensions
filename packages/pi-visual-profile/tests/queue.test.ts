import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { QueueStore, currentQueueContext } from "../queue-store.ts";
import { QueueDelivery } from "../queue-delivery.ts";

function withStore(fn: (store: QueueStore, directory: string) => void): void {
	const directory = mkdtempSync(join(tmpdir(), "visual-profile-queue-"));
	try {
		const store = new QueueStore({
			inboxPath: join(directory, "inbox.jsonl"),
			aliasesPath: join(directory, "aliases.json"),
			ownerPath: join(directory, "owner"),
		});
		assert.equal(store.acquireOwner("owner-a"), true);
		fn(store, directory);
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

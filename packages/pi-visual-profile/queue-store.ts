import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type QueueIntent = "steer" | "follow-up" | "post-compact";
export type QueueStatus = "queued" | "blocked" | "delivering" | "sent" | "failed";
export type QueueTarget = { kind: "current-session" } | { kind: "project"; cwd: string; alias?: string } | { kind: "global" };
export interface QueueContext { cwd: string; sessionId?: string }
export interface QueueItem {
	id: string;
	text: string;
	createdAt: number;
	updatedAt: number;
	source: QueueContext;
	target: QueueTarget;
	intent: QueueIntent;
	status: QueueStatus;
	error?: string;
}
export interface QueueStorePaths { inboxPath: string; aliasesPath: string; ownerPath: string }
export interface CreateQueueItem { text: string; source: QueueContext; target: QueueTarget; intent: QueueIntent; now?: number }

const ACTIVE_STATUSES = new Set<QueueStatus>(["queued", "blocked", "delivering", "failed"]);
const STALE_LOCK_MS = 30_000;
const LOCK_WAIT_MS = 2_000;

function sleep(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseContext(context: QueueContext): QueueContext {
	const sessionId = context.sessionId?.trim();
	return sessionId ? { cwd: resolve(context.cwd), sessionId } : { cwd: resolve(context.cwd) };
}

function normaliseTarget(value: unknown): QueueTarget | null {
	if (!isRecord(value)) return null;
	if (value.kind === "current-session" || value.kind === "global") return { kind: value.kind };
	if (value.kind !== "project" || typeof value.cwd !== "string" || !value.cwd.trim()) return null;
	return typeof value.alias === "string" && value.alias.trim()
		? { kind: "project", cwd: resolve(value.cwd), alias: value.alias.trim() }
		: { kind: "project", cwd: resolve(value.cwd) };
}

function parseItem(value: unknown): QueueItem | null {
	if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.text !== "string" || !value.text.trim()) return null;
	if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt) || typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) return null;
	if (!isRecord(value.source) || typeof value.source.cwd !== "string" || !value.source.cwd.trim()) return null;
	const target = normaliseTarget(value.target);
	if (!target || (value.intent !== "steer" && value.intent !== "follow-up" && value.intent !== "post-compact")) return null;
	if (value.status !== "queued" && value.status !== "blocked" && value.status !== "delivering" && value.status !== "sent" && value.status !== "failed") return null;
	return {
		id: value.id.trim(), text: value.text, createdAt: value.createdAt, updatedAt: value.updatedAt,
		source: normaliseContext({ cwd: value.source.cwd, ...(typeof value.source.sessionId === "string" ? { sessionId: value.source.sessionId } : {}) }),
		target, intent: value.intent, status: value.status,
		...(typeof value.error === "string" && value.error.trim() ? { error: value.error.trim() } : {}),
	};
}

function readLease(path: string): { id: string; createdAt: number } | null {
	try {
		const value = JSON.parse(readFileSync(`${path}/lease.json`, "utf8"));
		return isRecord(value) && typeof value.id === "string" && typeof value.createdAt === "number" ? { id: value.id, createdAt: value.createdAt } : null;
	} catch { return null; }
}

function writeLease(path: string, id: string, createdAt: number): void {
	const temporaryPath = `${path}/lease.json.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, JSON.stringify({ id, createdAt }));
	renameSync(temporaryPath, `${path}/lease.json`);
}

export function currentQueueContext(cwd: string, sessionId?: string): QueueContext {
	return normaliseContext({ cwd, ...(sessionId ? { sessionId } : {}) });
}

export function getQueueStorePaths(agentDir: string): QueueStorePaths {
	const directory = `${agentDir}/visual-profile/queue`;
	return { inboxPath: `${directory}/inbox.jsonl`, aliasesPath: `${directory}/aliases.json`, ownerPath: `${directory}/owner` };
}

export function isActiveForContext(item: QueueItem, context: QueueContext): boolean {
	if (!ACTIVE_STATUSES.has(item.status)) return false;
	const current = normaliseContext(context);
	if (item.target.kind === "global") return true;
	if (item.target.kind === "project") return item.target.cwd === current.cwd;
	return item.source.sessionId ? item.source.sessionId === current.sessionId : item.source.cwd === current.cwd;
}

export class QueueStore {
	private ownerId: string | null = null;
	private readonly paths: QueueStorePaths;

	constructor(paths: QueueStorePaths) { this.paths = paths; }

	acquireOwner(id: string, now = Date.now()): boolean {
		return this.withLeaseOperationLock(() => {
			mkdirSync(dirname(this.paths.ownerPath), { recursive: true });
			while (true) {
				try {
					mkdirSync(this.paths.ownerPath);
					writeLease(this.paths.ownerPath, id, now);
					this.ownerId = id;
					return true;
				} catch (error) {
					if (!isRecord(error) || error.code !== "EEXIST") throw error;
					const lease = readLease(this.paths.ownerPath);
					if (lease && now - lease.createdAt <= STALE_LOCK_MS) return false;
					rmSync(this.paths.ownerPath, { recursive: true, force: true });
				}
			}
		});
	}

	ownerReason(): string | null {
		const lease = readLease(this.paths.ownerPath);
		if (!lease) return "Queue is read-only: owner lease is missing";
		return lease.id !== this.ownerId ? `Queue is read-only: active owner ${lease.id}` : null;
	}

	refreshOwner(now = Date.now()): boolean {
		return this.withLeaseOperationLock(() => {
			if (!this.ownerId || this.ownerReason()) return false;
			writeLease(this.paths.ownerPath, this.ownerId, now);
			return true;
		});
	}

	releaseOwner(): void {
		if (!this.ownerId) return;
		this.withLeaseOperationLock(() => {
			if (readLease(this.paths.ownerPath)?.id === this.ownerId) rmSync(this.paths.ownerPath, { recursive: true, force: true });
			this.ownerId = null;
		});
	}

	list(): QueueItem[] {
		if (!existsSync(this.paths.inboxPath)) return [];
		const items: QueueItem[] = [];
		for (const line of readFileSync(this.paths.inboxPath, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try { const item = parseItem(JSON.parse(line)); if (item) items.push(item); } catch { /* JSONL is a stable read-only integration surface. */ }
		}
		return items.sort((left, right) => left.createdAt - right.createdAt);
	}

	add(input: CreateQueueItem): QueueItem {
		this.assertOwner();
		const now = input.now ?? Date.now();
		const item: QueueItem = { id: randomUUID().slice(0, 8), text: input.text, createdAt: now, updatedAt: now, source: normaliseContext(input.source), target: normaliseTarget(input.target) ?? input.target, intent: input.intent, status: "queued" };
		this.withWriteLock(() => this.write([...this.list(), item]));
		return item;
	}

	update(id: string, patch: Partial<Omit<QueueItem, "id" | "createdAt">>): QueueItem | null {
		this.assertOwner();
		let result: QueueItem | null = null;
		this.withWriteLock(() => {
			const items = this.list();
			const index = items.findIndex((item) => item.id === id);
			if (index === -1) return;
			const item = items[index];
			if (!item) return;
			result = { ...item, ...patch, updatedAt: patch.updatedAt ?? Date.now() };
			items[index] = result;
			this.write(items);
		});
		return result;
	}

	get(idPrefix: string): QueueItem | null {
		const matches = this.list().filter((item) => item.id === idPrefix || item.id.startsWith(idPrefix));
		return matches.length === 1 ? matches[0] ?? null : null;
	}

	requeueDelivering(error: string): number {
		this.assertOwner();
		let count = 0;
		this.withWriteLock(() => {
			const items = this.list();
			for (const item of items) {
				if (item.status !== "delivering") continue;
				item.status = "queued";
				item.error = error;
				item.updatedAt = Date.now();
				count++;
			}
			if (count) this.write(items);
		});
		return count;
	}

	activeItems(context: QueueContext): QueueItem[] { return this.list().filter((item) => isActiveForContext(item, context)); }
	queuedDeliveryItems(context: QueueContext, intent?: QueueIntent): QueueItem[] { return this.activeItems(context).filter((item) => item.status === "queued" && (!intent || item.intent === intent)); }

	private assertOwner(): void {
		if (!this.ownerId || this.ownerReason()) throw new Error(this.ownerReason() ?? "Queue is read-only: this runtime is not the owner");
	}

	private withLeaseOperationLock<T>(fn: () => T): T {
		const lockPath = `${this.paths.ownerPath}.lock`;
		const deadline = Date.now() + LOCK_WAIT_MS;
		mkdirSync(dirname(lockPath), { recursive: true });
		while (true) {
			try {
				mkdirSync(lockPath);
				writeLease(lockPath, this.ownerId ?? "lease-operation", Date.now());
				break;
			} catch (error) {
				if (!isRecord(error) || error.code !== "EEXIST") throw error;
				const lease = readLease(lockPath);
				if (!lease || Date.now() - lease.createdAt > STALE_LOCK_MS) {
					rmSync(lockPath, { recursive: true, force: true });
					continue;
				}
				if (Date.now() >= deadline) throw new Error("Queue has an active queue lease operation");
				sleep(25);
			}
		}
		try { return fn(); } finally { rmSync(lockPath, { recursive: true, force: true }); }
	}

	private withWriteLock(fn: () => void): void {
		const lockPath = `${this.paths.inboxPath}.lock`;
		const deadline = Date.now() + LOCK_WAIT_MS;
		mkdirSync(dirname(lockPath), { recursive: true });
		while (true) {
			try {
				mkdirSync(lockPath);
				writeLease(lockPath, this.ownerId ?? "queue-write", Date.now());
				break;
			} catch (error) {
				if (!isRecord(error) || error.code !== "EEXIST") throw error;
				const lease = readLease(lockPath);
				if (!lease || Date.now() - lease.createdAt > STALE_LOCK_MS) {
					rmSync(lockPath, { recursive: true, force: true });
					continue;
				}
				if (Date.now() >= deadline) throw new Error("Queue has an active queue write");
				sleep(25);
			}
		}
		try { fn(); } finally { rmSync(lockPath, { recursive: true, force: true }); }
	}

	private write(items: QueueItem[]): void {
		const temporaryPath = `${this.paths.inboxPath}.${process.pid}.${Date.now()}.tmp`;
		const preserved = existsSync(this.paths.inboxPath)
			? readFileSync(this.paths.inboxPath, "utf8").split("\n").filter((line) => {
				if (!line.trim()) return false;
				try { return !parseItem(JSON.parse(line)); } catch { return true; }
			})
			: [];
		const lines = [...items.map((item) => JSON.stringify(item)), ...preserved];
		writeFileSync(temporaryPath, lines.join("\n") + (lines.length ? "\n" : ""));
		renameSync(temporaryPath, this.paths.inboxPath);
	}
}

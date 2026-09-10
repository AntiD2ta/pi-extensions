import type { QueueItem } from "./queue-store.ts";
import { QueueStore } from "./queue-store.ts";

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 30_000;

export class QueueDelivery {
	private readonly pending = new Map<string, { text: string; timer: ReturnType<typeof setTimeout> }>();
	private readonly store: QueueStore;
	private readonly submit: (text: string, item: QueueItem) => void;
	private readonly confirmationTimeoutMs: number;

	constructor(store: QueueStore, submit: (text: string, item: QueueItem) => void, confirmationTimeoutMs = DEFAULT_CONFIRMATION_TIMEOUT_MS) {
		this.store = store;
		this.submit = submit;
		this.confirmationTimeoutMs = confirmationTimeoutMs;
	}

	deliver(item: QueueItem): boolean {
		const delivering = this.store.update(item.id, { status: "delivering", error: undefined });
		if (!delivering) return false;
		try {
			const timer = setTimeout(() => this.requeue(item.id, "Pi did not start queued message delivery"), this.confirmationTimeoutMs);
			timer.unref();
			this.pending.set(item.id, { text: item.text, timer });
			this.submit(item.text, item);
			return true;
		} catch (error) {
			this.clearPending(item.id);
			this.store.update(item.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
			return false;
		}
	}

	observeUserMessage(text: string): boolean {
		const normalized = text.replace(/\s+/g, " ").trim();
		for (const [id, pending] of this.pending) {
			if (pending.text.replace(/\s+/g, " ").trim() !== normalized) continue;
			this.clearPending(id);
			this.store.update(id, { status: "sent", error: undefined });
			return true;
		}
		return false;
	}

	requeuePending(error: string): void {
		for (const id of this.pending.keys()) this.requeue(id, error);
	}

	discardPending(): void {
		for (const id of this.pending.keys()) this.clearPending(id);
	}

	private requeue(id: string, error: string): void {
		if (!this.clearPending(id)) return;
		this.store.update(id, { status: "queued", error });
	}

	private clearPending(id: string): boolean {
		const pending = this.pending.get(id);
		if (!pending) return false;
		clearTimeout(pending.timer);
		this.pending.delete(id);
		return true;
	}
}

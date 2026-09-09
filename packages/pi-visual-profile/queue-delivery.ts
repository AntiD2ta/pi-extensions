import type { QueueItem } from "./queue-store.ts";
import { QueueStore } from "./queue-store.ts";

export class QueueDelivery {
	private readonly pending = new Map<string, string>();
	private readonly store: QueueStore;
	private readonly submit: (text: string, item: QueueItem) => void;

	constructor(store: QueueStore, submit: (text: string, item: QueueItem) => void) {
		this.store = store;
		this.submit = submit;
	}

	deliver(item: QueueItem): boolean {
		const delivering = this.store.update(item.id, { status: "delivering", error: undefined });
		if (!delivering) return false;
		try {
			this.pending.set(item.id, item.text);
			this.submit(item.text, item);
			return true;
		} catch (error) {
			this.pending.delete(item.id);
			this.store.update(item.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
			return false;
		}
	}

	observeUserMessage(text: string): boolean {
		const normalized = text.replace(/\s+/g, " ").trim();
		for (const [id, pending] of this.pending) {
			if (pending.replace(/\s+/g, " ").trim() !== normalized) continue;
			this.pending.delete(id);
			this.store.update(id, { status: "sent", error: undefined });
			return true;
		}
		return false;
	}

	requeuePending(error: string): void {
		for (const id of this.pending.keys()) this.store.update(id, { status: "queued", error });
		this.pending.clear();
	}
}

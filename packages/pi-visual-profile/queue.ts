import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { QueueDelivery } from "./queue-delivery.ts";
import { QueueStore, currentQueueContext, getQueueStorePaths, type QueueItem } from "./queue-store.ts";

function sessionId(ctx: ExtensionContext): string | undefined {
	const id = ctx.sessionManager.getSessionId();
	return id.trim() ? id : undefined;
}

function context(ctx: ExtensionContext) {
	return currentQueueContext(ctx.cwd, sessionId(ctx));
}

function textFromMessage(message: { content: unknown }): string | null {
	if (!Array.isArray(message.content)) return null;
	const text = message.content.flatMap((part) => typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : []).join("");
	return text || null;
}

export default function (pi: ExtensionAPI) {
	let store: QueueStore | null = null;
	let delivery: QueueDelivery | null = null;
	let compacting = false;
	let deliverAfterRetrySettles = false;
	let ownerHeartbeat: ReturnType<typeof setInterval> | null = null;

	function refreshStatus(ctx: ExtensionContext): void {
		if (!store) return;
		const reason = store.ownerReason();
		if (reason) return;
		const count = store.activeItems(context(ctx)).length;
		ctx.ui.setStatus("visual-profile-queue", count ? `queue ${count}` : undefined);
	}

	function deliver(ctx: ExtensionContext, item: QueueItem): void {
		if (!delivery || compacting) return;
		const sent = delivery.deliver(item);
		if (!sent) ctx.ui.notify(`Failed to submit queued item ${item.id}`, "error");
		refreshStatus(ctx);
	}

	function deliverPostCompact(ctx: ExtensionContext): void {
		const item = store?.queuedDeliveryItems(context(ctx), "post-compact")[0];
		if (item) deliver(ctx, item);
	}

	pi.on("session_start", (_event, ctx) => {
		compacting = false;
		deliverAfterRetrySettles = false;
		store = new QueueStore(getQueueStorePaths(getAgentDir()));
		const owner = sessionId(ctx) ?? `${process.pid}-${Date.now()}`;
		const ownsQueue = store.acquireOwner(owner);
		if (ownsQueue) {
			ownerHeartbeat = setInterval(() => {
				if (!store?.refreshOwner() && ownerHeartbeat) clearInterval(ownerHeartbeat);
			}, 10_000);
			ownerHeartbeat.unref();
		}
		delivery = new QueueDelivery(store, (text, item) => {
			if (ctx.isIdle()) pi.sendUserMessage(text);
			else pi.sendUserMessage(text, { deliverAs: item.intent === "steer" ? "steer" : "followUp" });
		});
		refreshStatus(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ownerHeartbeat) clearInterval(ownerHeartbeat);
		ownerHeartbeat = null;
		delivery?.requeuePending("Session ended before queued message started");
		store?.releaseOwner();
		ctx.ui.setStatus("visual-profile-queue", undefined);
		store = null;
		delivery = null;
		deliverAfterRetrySettles = false;
	});

	pi.on("message_start", (event, ctx) => {
		if (event.message.role !== "user") return;
		const text = textFromMessage(event.message);
		if (text && delivery?.observeUserMessage(text)) refreshStatus(ctx);
	});

	pi.on("session_before_compact", () => { compacting = true; });
	pi.on("session_compact", (event, ctx) => {
		compacting = false;
		deliverAfterRetrySettles = event.willRetry;
		if (!event.willRetry) deliverPostCompact(ctx);
		refreshStatus(ctx);
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!deliverAfterRetrySettles) return;
		deliverAfterRetrySettles = false;
		deliverPostCompact(ctx);
		refreshStatus(ctx);
	});

	pi.on("input", (event, ctx) => {
		const match = /^\/compact\s+(.+)$/s.exec(event.text.trim());
		if (!match || !store) return { action: "continue" as const };
		const reason = store.ownerReason();
		if (reason) {
			ctx.ui.notify(reason, "warning");
			return { action: "continue" as const };
		}
		const text = match[1].trim();
		if (!text) return { action: "continue" as const };
		const queueStore = store;
		const item = queueStore.add({ text, source: context(ctx), target: { kind: "current-session" }, intent: "post-compact" });
		compacting = true;
		try {
			ctx.compact({ onError: (error) => {
				if (store !== queueStore) return;
				compacting = false;
				queueStore.update(item.id, { status: "blocked", error: error.message });
				refreshStatus(ctx);
			} });
		} catch (error) {
			compacting = false;
			queueStore.update(item.id, { status: "blocked", error: error instanceof Error ? error.message : String(error) });
			ctx.ui.notify(`Could not compact queued item ${item.id}`, "error");
		}
		refreshStatus(ctx);
		return { action: "handled" as const };
	});

}

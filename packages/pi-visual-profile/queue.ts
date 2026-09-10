import { CustomEditor, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
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
	let postCompactDeliveryTimer: ReturnType<typeof setTimeout> | null = null;
	let ownsQueue = false;

	function refreshStatus(ctx: ExtensionContext): void {
		if (!store || !ownsQueue || store.ownerReason()) return;
		const count = store.activeItems(context(ctx)).length;
		ctx.ui.setStatus("visual-profile-queue", count ? `queue ${count}` : undefined);
	}

	function deliver(ctx: ExtensionContext, item: QueueItem): void {
		if (!ownsQueue || !delivery || compacting) return;
		const sent = delivery.deliver(item);
		if (!sent) ctx.ui.notify(`Failed to submit queued item ${item.id}`, "error");
		refreshStatus(ctx);
	}

	function deliverNext(ctx: ExtensionContext): void {
		if (!ownsQueue) return;
		const item = store?.queuedDeliveryItems(context(ctx))[0];
		if (item) deliver(ctx, item);
	}

	function schedulePostCompactDelivery(ctx: ExtensionContext): void {
		if (!ownsQueue) return;
		if (postCompactDeliveryTimer) clearTimeout(postCompactDeliveryTimer);
		const queueStore = store;
		postCompactDeliveryTimer = setTimeout(() => {
			postCompactDeliveryTimer = null;
			if (ownsQueue && store === queueStore) deliverNext(ctx);
		}, 50);
	}

	function compactWithQueuedText(ctx: ExtensionContext, text: string): boolean {
		if (!store || !ownsQueue || !text || store.ownerReason()) return false;
		const queueStore = store;
		const item = queueStore.add({ text, source: context(ctx), target: { kind: "current-session" }, intent: "post-compact" });
		compacting = true;
		try {
			ctx.compact({ onError: (error) => {
				if (!ownsQueue || store !== queueStore) return;
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
		return true;
	}

	pi.on("session_start", (_event, ctx) => {
		compacting = false;
		deliverAfterRetrySettles = false;
		store = new QueueStore(getQueueStorePaths(getAgentDir()));
		const owner = sessionId(ctx) ?? `${process.pid}-${Date.now()}`;
		ownsQueue = store.acquireOwner(owner);
		if (!ownsQueue) return;
		store.requeueDelivering("Pi did not confirm queued message delivery");
		ownerHeartbeat = setInterval(() => {
			if (store?.refreshOwner()) return;
			ownsQueue = false;
			delivery?.discardPending();
			ctx.ui.setStatus("visual-profile-queue", undefined);
			if (ownerHeartbeat) clearInterval(ownerHeartbeat);
		}, 10_000);
		ownerHeartbeat.unref();
		delivery = new QueueDelivery(store, (text, item) => {
			pi.sendUserMessage(text, { deliverAs: item.intent === "steer" ? "steer" : "followUp" });
		});
		const compact = ctx.compact;
		const previousEditor = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = previousEditor?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
			const handleInput = editor.handleInput.bind(editor);
			editor.handleInput = (data) => {
				const isSubmit = keybindings.matches(data, "tui.input.submit") && !keybindings.matches(data, "tui.input.newLine");
				if (!compacting && isSubmit && typeof compact === "function") {
					const text = (editor.getExpandedText?.() ?? editor.getText()).trim();
					const match = /^\/compact\s+(.+)$/s.exec(text);
					if (text === "/compact" || match) {
						if (match && (!ownsQueue || !store || store.ownerReason())) {
							handleInput(data);
							return;
						}
						editor.addToHistory?.(text);
						editor.setText("");
						if (match) compactWithQueuedText(ctx, match[1].trim());
						if (!match) {
							compacting = true;
							compact();
						}
						return;
					}
				}
				handleInput(data);
			};
			return editor;
		});
		schedulePostCompactDelivery(ctx);
		refreshStatus(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ownerHeartbeat) clearInterval(ownerHeartbeat);
		if (postCompactDeliveryTimer) clearTimeout(postCompactDeliveryTimer);
		ownerHeartbeat = null;
		postCompactDeliveryTimer = null;
		if (ownsQueue) {
			delivery?.requeuePending("Session ended before queued message started");
			store?.releaseOwner();
		}
		ctx.ui.setStatus("visual-profile-queue", undefined);
		ownsQueue = false;
		store = null;
		delivery = null;
		deliverAfterRetrySettles = false;
	});

	pi.on("message_start", (event, ctx) => {
		if (!ownsQueue || event.message.role !== "user") return;
		const text = textFromMessage(event.message);
		if (text && delivery?.observeUserMessage(text)) {
			schedulePostCompactDelivery(ctx);
			refreshStatus(ctx);
		}
	});

	pi.on("session_before_compact", () => { if (ownsQueue) compacting = true; });
	pi.on("session_compact", (event, ctx) => {
		if (!ownsQueue) return;
		compacting = false;
		deliverAfterRetrySettles = event.willRetry;
		if (!event.willRetry) schedulePostCompactDelivery(ctx);
		refreshStatus(ctx);
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!ownsQueue || !deliverAfterRetrySettles) return;
		deliverAfterRetrySettles = false;
		schedulePostCompactDelivery(ctx);
		refreshStatus(ctx);
	});

	pi.on("input", (event, ctx) => {
		if (event.source === "extension") return { action: "continue" as const };
		const match = /^\/compact\s+(.+)$/s.exec(event.text.trim());
		if (!match || !compactWithQueuedText(ctx, match[1].trim())) return { action: "continue" as const };
		return { action: "handled" as const };
	});
}

import { lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isWriteToolResult, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import { requiredHandoffHeadings } from "./handoff-headings.ts";
import { createHandoffPrompt } from "./handoff-prompt.ts";

const handoffBoundaryEntryType = "handoff-compaction-boundary";
const neutralCompactionSummary = "The prior task state was externalized. Follow the next user message.";
type HandoffOperation = {
	phase: "awaiting-cancellation" | "awaiting-settlement" | "awaiting-replacement";
	handoffPath: string;
	initialPrompt: string;
	focus: string | undefined;
	writeSucceeded: boolean;
	writeFailed: boolean;
	handoffTurnAborted: boolean;
	boundaryId?: string;
};

function validHandoff(handoffPath: string) {
	try {
		if (!lstatSync(handoffPath).isFile()) return false;
		const content = readFileSync(handoffPath, "utf8").replaceAll("\r\n", "\n");
		const headings = [...content.matchAll(/^## (.+)$/gm)];
		return content.trim().length > 0
			&& headings.length === requiredHandoffHeadings.length
			&& headings.every((match, index) => match[1] === requiredHandoffHeadings[index]
				&& content.slice((match.index ?? 0) + match[0].length, headings[index + 1]?.index).trim().length > 0);
	} catch {
		return false;
	}
}

function initialPrompt(branchEntries: Array<{ type: string; message?: { role?: string; content?: unknown } }>) {
	const message = branchEntries.find((entry) => entry.type === "message" && entry.message?.role === "user")?.message;
	if (typeof message?.content === "string") return message.content;
	if (!Array.isArray(message?.content)) return "";
	return message.content
		.filter((part): part is { type: "text"; text: string } => (
			typeof part === "object" && part !== null && part.type === "text" && typeof part.text === "string"
		))
		.map((part) => part.text)
		.join("\n");
}

export default function handoffCompaction(pi: ExtensionAPI) {
	let operation: HandoffOperation | undefined;

	function reportHandoffFailure(ctx: ExtensionContext, reason: string) {
		operation = undefined;
		const message = `Handoff compaction failed before context replacement: ${reason}. The conversation was not compacted.`;
		pi.appendEntry("handoff-compaction-failure", { reason });
		if (ctx.hasUI) ctx.ui.notify(message, "error");
		else console.error(message);
	}

	function writeToolFailureReason() {
		return pi.getAllTools().some((tool) => tool.name === "write")
			? "the write tool is inactive"
			: "the write tool is unavailable";
	}

	pi.on("session_before_compact", (event, ctx) => {
		if (event.reason === "manual" && operation?.phase === "awaiting-replacement" && operation.boundaryId !== undefined) {
			return {
				compaction: {
					summary: neutralCompactionSummary,
					firstKeptEntryId: operation.boundaryId,
					tokensBefore: event.preparation.tokensBefore,
				},
			};
		}
		if (operation !== undefined) return { cancel: true };
		if (event.reason !== "manual") return;
		if (!pi.getActiveTools().includes("write")) {
			reportHandoffFailure(ctx, writeToolFailureReason());
			return { cancel: true };
		}

		operation = {
			phase: "awaiting-cancellation",
			handoffPath: join(tmpdir(), `pi-handoff-${randomUUID()}.md`),
			initialPrompt: initialPrompt(event.branchEntries),
			focus: event.customInstructions?.trim() || undefined,
			writeSucceeded: false,
			writeFailed: false,
			handoffTurnAborted: false,
		};
		return { cancel: true };
	});

	pi.on("session_compact_failed", (event, ctx) => {
		if (event.reason !== "manual" || operation?.phase !== "awaiting-cancellation") return;
		if (!event.aborted) {
			reportHandoffFailure(ctx, "the original compaction was not aborted");
			return;
		}
		if (!pi.getActiveTools().includes("write")) {
			reportHandoffFailure(ctx, writeToolFailureReason());
			return;
		}

		operation.phase = "awaiting-settlement";
		try {
			pi.sendUserMessage(createHandoffPrompt(operation));
		} catch {
			reportHandoffFailure(ctx, "the handoff turn could not be started");
		}
	});

	pi.on("tool_result", (event) => {
		if (operation?.phase !== "awaiting-settlement" || !isWriteToolResult(event)) return;
		if (event.isError || event.input.path !== operation.handoffPath) operation.writeFailed = true;
		else operation.writeSucceeded = true;
	});

	pi.on("session_shutdown", (event, ctx) => {
		if (operation === undefined) return;
		const reason = {
			quit: "the session was shut down",
			reload: "the session was reloaded",
			new: "the session was replaced",
			resume: "the session was resumed",
			fork: "the session was forked",
		}[event.reason];
		reportHandoffFailure(ctx, reason);
	});

	pi.on("agent_end", (event) => {
		if (operation?.phase !== "awaiting-settlement") return;
		operation.handoffTurnAborted = event.messages.some((message) => (
			message.role === "assistant" && (message.stopReason === "aborted" || message.stopReason === "error")
		));
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (operation?.phase !== "awaiting-settlement") return;
		if (operation.handoffTurnAborted) {
			reportHandoffFailure(ctx, "the handoff turn was aborted");
			return;
		}
		if (operation.writeFailed || !operation.writeSucceeded) {
			reportHandoffFailure(ctx, "the handoff file was not written successfully");
			return;
		}
		if (!validHandoff(operation.handoffPath)) {
			reportHandoffFailure(ctx, "the handoff file is invalid");
			return;
		}

		pi.appendEntry(handoffBoundaryEntryType, { handoffPath: operation.handoffPath });
		const boundaryId = ctx.sessionManager.getLeafId();
		if (boundaryId === null) {
			reportHandoffFailure(ctx, "the handoff boundary could not be recorded");
			return;
		}
		operation.boundaryId = boundaryId;
		operation.phase = "awaiting-replacement";
		const completedOperation = operation;
		try {
			ctx.compact({
				onComplete: () => {
					if (operation !== completedOperation) return;
					operation = undefined;
					pi.sendUserMessage(`Read and follow ${completedOperation.handoffPath}`);
				},
				onError: () => {
					if (operation === completedOperation) reportHandoffFailure(ctx, "the replacement compaction failed");
				},
			});
		} catch {
			reportHandoffFailure(ctx, "the replacement compaction could not be started");
		}
	});
}

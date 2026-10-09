import { lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isWriteToolResult, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isContextOverflow } from "@earendil-works/pi-ai";

import { requiredHandoffHeadings } from "./handoff-headings.ts";
import { createHandoffPrompt } from "./handoff-prompt.ts";

const handoffBoundaryEntryType = "handoff-compaction-boundary";
const neutralCompactionSummary = "The prior task state was externalized. Follow the next user message.";
const maximumAutomaticHandoffTokens = 275_000;
const coordinationChannel = "pi-handoff-compaction:v1";
type HandoffTrigger = "manual" | "threshold" | "overflow";
type HandoffOperation = {
	phase: "awaiting-cancellation" | "awaiting-handoff" | "awaiting-settlement" | "awaiting-replacement" | "awaiting-continuation" | "awaiting-continuation-settlement";
	trigger: HandoffTrigger;
	orchestrationId: string;
	sessionId: string | undefined;
	handoffPath: string;
	initialPrompt: string;
	focus: string | undefined;
	writeSucceeded: boolean;
	writeFailed: boolean;
	handoffTurnAborted: boolean;
	continuationTurnAborted: boolean;
	powerlineCapturesInput: boolean;
	boundaryId?: string;
	continuationPrompt?: string;
};

function validHandoff(handoffPath: string) {
	try {
		if (!lstatSync(handoffPath).isFile()) return false;
		const content = readFileSync(handoffPath, "utf8").replaceAll("\r\n", "\n");
		let fence = "";
		const outsideFences = content.split("\n").map((line) => {
			const wasFenced = fence.length > 0;
			const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
			if (marker) {
				if (wasFenced) {
					if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = "";
				} else if (marker[1][0] !== "`" || !marker[2].includes("`")) {
					fence = marker[1];
				}
			}
			return wasFenced || fence ? " ".repeat(line.length) : line;
		}).join("\n");
		let nextHeading = 0;
		const sections = [...outsideFences.matchAll(/^## (.+)$/gm)].filter((match) => {
			if (match[1] !== requiredHandoffHeadings[nextHeading]) return false;
			nextHeading++;
			return true;
		});
		return sections.length === requiredHandoffHeadings.length
			&& sections.every((match, index) => match[1] === requiredHandoffHeadings[index]
				&& content.slice(match.index + match[0].length, sections[index + 1]?.index).replace(/^#{1,6} .+$/gm, "").trim().length > 0);
	} catch {
		return false;
	}
}

function needsAutomaticHandoff(ctx: ExtensionContext) {
	const usage = ctx.getContextUsage();
	const contextWindow = ctx.model?.contextWindow;
	if (usage?.tokens === null || usage === undefined || contextWindow === undefined) return false;
	const maximumTokens = ctx.model?.id?.includes("claude") && contextWindow >= 1_000_000
		? 500_000
		: maximumAutomaticHandoffTokens;
	return usage.tokens >= Math.min(contextWindow * 0.9, maximumTokens);
}

function sessionId(ctx: ExtensionContext): string | undefined {
	const id = ctx.sessionManager?.getSessionId?.();
	return typeof id === "string" && id.trim() ? id : undefined;
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
	let automaticTriggerPending = false;
	let automaticHandoffAttempted = false;
	let automaticAttemptId = 0;

	pi.events?.on?.(coordinationChannel, (event) => {
		if (typeof event !== "object" || event === null
			|| !("version" in event) || event.version !== 1
			|| !("kind" in event) || event.kind !== "acknowledged"
			|| !("capturesInput" in event) || event.capturesInput !== true
			|| !("sessionId" in event) || typeof event.sessionId !== "string"
			|| !("orchestrationId" in event) || typeof event.orchestrationId !== "string"
			|| operation?.sessionId !== event.sessionId
			|| operation.orchestrationId !== event.orchestrationId) return;
		operation.powerlineCapturesInput = true;
	});

	function reportHandoffFailure(ctx: ExtensionContext, reason: string) {
		const failedOperation = operation;
		operation = undefined;
		if (failedOperation?.sessionId) {
			pi.events?.emit(coordinationChannel, {
				version: 1,
				kind: "failure",
				sessionId: failedOperation.sessionId,
				orchestrationId: failedOperation.orchestrationId,
				reason,
			});
		}
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
		if (event.reason !== "manual" && event.reason !== "threshold" && event.reason !== "overflow") return;
		if (event.reason !== "manual" && automaticHandoffAttempted) return { cancel: true };
		automaticHandoffAttempted ||= event.reason !== "manual" || automaticTriggerPending;
		automaticTriggerPending = false;
		if (!pi.getActiveTools().includes("write")) {
			reportHandoffFailure(ctx, writeToolFailureReason());
			return { cancel: true };
		}

		operation = {
			phase: "awaiting-cancellation",
			trigger: event.reason,
			orchestrationId: randomUUID(),
			sessionId: sessionId(ctx),
			handoffPath: join(tmpdir(), `pi-handoff-${randomUUID()}.md`),
			initialPrompt: initialPrompt(event.branchEntries),
			focus: event.customInstructions?.trim() || undefined,
			writeSucceeded: false,
			writeFailed: false,
			handoffTurnAborted: false,
			continuationTurnAborted: false,
			powerlineCapturesInput: false,
		};
		if (operation.sessionId) {
			pi.events?.emit(coordinationChannel, {
				version: 1,
				kind: "hold",
				sessionId: operation.sessionId,
				orchestrationId: operation.orchestrationId,
			});
		}
		return { cancel: true };
	});

	function startHandoff(ctx: ExtensionContext, handoff: HandoffOperation) {
		handoff.phase = "awaiting-settlement";
		try {
			pi.sendUserMessage(createHandoffPrompt(handoff));
		} catch {
			reportHandoffFailure(ctx, "the handoff turn could not be started");
		}
	}

	pi.on("session_compact_failed", (event, ctx) => {
		if (operation?.phase !== "awaiting-cancellation" || event.reason !== operation.trigger) return;
		if (!event.aborted) {
			reportHandoffFailure(ctx, "the original compaction was not aborted");
			return;
		}
		if (!pi.getActiveTools().includes("write")) {
			reportHandoffFailure(ctx, writeToolFailureReason());
			return;
		}

		operation.phase = "awaiting-handoff";
		if (ctx.isIdle()) startHandoff(ctx, operation);
	});

	pi.on("before_agent_start", (event) => {
		if (operation?.phase !== "awaiting-continuation" || event.prompt !== operation.continuationPrompt) return;
		operation.phase = "awaiting-continuation-settlement";
	});

	pi.on("turn_end", (_event, ctx) => {
		if (operation !== undefined || automaticTriggerPending) return;
		if (!needsAutomaticHandoff(ctx)) {
			automaticHandoffAttempted = false;
			return;
		}
		if (automaticHandoffAttempted) return;
		automaticTriggerPending = true;
		automaticHandoffAttempted = true;
		const attemptId = ++automaticAttemptId;
		try {
			ctx.compact({
				onError: () => {
					if (!automaticTriggerPending || attemptId !== automaticAttemptId) return;
					automaticTriggerPending = false;
					reportHandoffFailure(ctx, "the automatic compaction could not be started");
				},
			});
		} catch {
			if (!automaticTriggerPending || attemptId !== automaticAttemptId) return;
			automaticTriggerPending = false;
			reportHandoffFailure(ctx, "the automatic compaction could not be started");
		}
	});

	pi.on("tool_result", (event) => {
		if (operation?.phase !== "awaiting-settlement" || !isWriteToolResult(event)) return;
		if (event.isError || event.input.path !== operation.handoffPath) operation.writeFailed = true;
		else operation.writeSucceeded = true;
	});

	pi.on("input", (event, ctx) => {
		if (operation === undefined || event.source === "extension") return { action: "continue" };
		if (operation.powerlineCapturesInput
			&& !event.images?.length
			&& !event.text.trim().startsWith("/")) return { action: "continue" };
		const message = "Handoff compaction is in progress. Wait for the continuation prompt to finish.";
		if (ctx.hasUI) ctx.ui.notify(message, "error");
		else console.error(message);
		return { action: "handled" };
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
		if (operation?.phase !== "awaiting-settlement" && operation?.phase !== "awaiting-continuation-settlement") return;
		const allowOverflow = operation.phase === "awaiting-settlement" && operation.writeSucceeded;
		const aborted = event.messages.some((message) => (
			message.role === "assistant" && (message.stopReason === "aborted"
				|| (message.stopReason === "error" && !(allowOverflow && isContextOverflow(message))))
		));
		if (operation.phase === "awaiting-settlement") operation.handoffTurnAborted = aborted;
		else operation.continuationTurnAborted = aborted;
	});

	pi.on("agent_settled", (event, ctx) => {
		if (operation?.phase === "awaiting-handoff") {
			if ("aborted" in event && event.aborted === true) {
				reportHandoffFailure(ctx, "the original run was aborted");
				return;
			}
			startHandoff(ctx, operation);
			return;
		}
		if (operation?.phase === "awaiting-continuation-settlement") {
			if (operation.continuationTurnAborted) {
				reportHandoffFailure(ctx, "the continuation turn was aborted");
				return;
			}
			if (operation.sessionId) {
				pi.events?.emit(coordinationChannel, {
					version: 1,
					kind: "release",
					sessionId: operation.sessionId,
					orchestrationId: operation.orchestrationId,
				});
			}
			operation = undefined;
			return;
		}
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
					const continuationPrompt = `Read and follow ${completedOperation.handoffPath}`;
					operation.phase = "awaiting-continuation";
					operation.continuationPrompt = continuationPrompt;
					try {
						pi.sendUserMessage(continuationPrompt);
					} catch {
						reportHandoffFailure(ctx, "the continuation prompt could not be started");
					}
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

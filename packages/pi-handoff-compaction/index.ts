import { lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isWriteToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createHandoffPrompt } from "./handoff-prompt.ts";

const handoffBoundaryEntryType = "handoff-compaction-boundary";
const neutralCompactionSummary = "The prior task state was externalized. Follow the next user message.";
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
type HandoffOperation = {
	phase: "awaiting-cancellation" | "awaiting-settlement" | "awaiting-replacement";
	handoffPath: string;
	initialPrompt: string;
	focus: string | undefined;
	writeSucceeded: boolean;
	boundaryId?: string;
};

function validHandoff(handoffPath: string) {
	try {
		if (!lstatSync(handoffPath).isFile()) return false;
		const content = readFileSync(handoffPath, "utf8");
		return content.trim().length > 0 && headings.every((heading) => new RegExp(`^## ${heading}$`, "m").test(content));
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

	pi.on("session_before_compact", (event) => {
		if (event.reason === "manual" && operation?.phase === "awaiting-replacement" && operation.boundaryId !== undefined) {
			return {
				compaction: {
					summary: neutralCompactionSummary,
					firstKeptEntryId: operation.boundaryId,
					tokensBefore: event.preparation.tokensBefore,
				},
			};
		}
		if (event.reason !== "manual" || operation !== undefined) return;

		operation = {
			phase: "awaiting-cancellation",
			handoffPath: join(tmpdir(), `pi-handoff-${randomUUID()}.md`),
			initialPrompt: initialPrompt(event.branchEntries),
			focus: event.customInstructions?.trim() || undefined,
			writeSucceeded: false,
		};
		return { cancel: true };
	});

	pi.on("session_compact_failed", (event) => {
		if (event.reason !== "manual" || operation?.phase !== "awaiting-cancellation") return;
		if (!pi.getActiveTools().includes("write")) {
			operation = undefined;
			return;
		}

		operation.phase = "awaiting-settlement";
		pi.sendUserMessage(createHandoffPrompt(operation));
	});

	pi.on("tool_result", (event) => {
		if (operation?.phase !== "awaiting-settlement" || !isWriteToolResult(event)) return;
		if (!event.isError && event.input.path === operation.handoffPath) operation.writeSucceeded = true;
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (operation?.phase !== "awaiting-settlement") return;
		if (!operation.writeSucceeded || !validHandoff(operation.handoffPath)) {
			operation = undefined;
			return;
		}

		pi.appendEntry(handoffBoundaryEntryType, { handoffPath: operation.handoffPath });
		const boundaryId = ctx.sessionManager.getLeafId();
		if (boundaryId === null) {
			operation = undefined;
			return;
		}
		operation.boundaryId = boundaryId;
		operation.phase = "awaiting-replacement";
		const completedOperation = operation;
		ctx.compact({
			onComplete: () => {
				if (operation !== completedOperation) return;
				operation = undefined;
				pi.sendUserMessage(`Read and follow ${completedOperation.handoffPath}`);
			},
			onError: () => {
				if (operation === completedOperation) operation = undefined;
			},
		});
	});
}

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

const requestUserInputParameters = Type.Object({
	context: Type.String({ minLength: 1, description: "Context needed to make the decision" }),
	question: Type.String({ minLength: 1, description: "Precise question for the user" }),
	recommendedAnswer: Type.String({ minLength: 1, description: "Recommended answer" }),
	rationale: Type.String({ minLength: 1, description: "Why this answer is recommended" }),
});

type RequestUserInput = Static<typeof requestUserInputParameters>;

interface InputRequest extends RequestUserInput {
	toolCallId: string;
}

interface InputResolution {
	toolCallId: string;
}

function isInputRequest(value: unknown): value is RequestUserInput {
	if (!value || typeof value !== "object") return false;
	const details = value as Record<string, unknown>;
	return [details.context, details.question, details.recommendedAnswer, details.rationale]
		.every((field) => typeof field === "string" && field.length > 0);
}

function isInputResolution(value: unknown): value is InputResolution {
	return Boolean(value && typeof value === "object" && typeof (value as Record<string, unknown>).toolCallId === "string");
}

export default function (pi: ExtensionAPI) {
	let unresolvedRequest: InputRequest | undefined;

	const requestUserInputTool = defineTool<typeof requestUserInputParameters, InputRequest>({
		name: "request_user_input",
		label: "Request user input",
		description: "Stop and ask the user for free-text input when work cannot continue without it.",
		promptSnippet: "Request required free-text input from the user and end the current run",
		promptGuidelines: [
			"Call request_user_input only when work cannot continue without user input, and make it the sole final tool call.",
		],
		parameters: requestUserInputParameters,
		async execute(toolCallId, params) {
			const request = { ...params, toolCallId };
			unresolvedRequest = request;
			return {
				content: [{ type: "text", text: "Waiting for user input." }],
				details: request,
				terminate: true,
			};
		},
		renderResult(result, _options, theme) {
			const request = result.details;
			return new Text([
				theme.fg("muted", "Context"),
				request.context,
				theme.fg("muted", "Question"),
				request.question,
				theme.fg("muted", "Recommended answer"),
				request.recommendedAnswer,
				theme.fg("muted", "Rationale"),
				request.rationale,
			].join("\n"), 0, 0);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		pi.registerTool(requestUserInputTool);
		unresolvedRequest = undefined;
		const branch = ctx.sessionManager.getBranch();
		for (const entry of branch) {
			if (entry.type === "message" && entry.message.role === "toolResult") {
				if (entry.message.toolName === "request_user_input" && isInputRequest(entry.message.details)) {
					unresolvedRequest = { ...entry.message.details, toolCallId: entry.message.toolCallId };
				}
				continue;
			}
			if (entry.type !== "custom" || entry.customType !== "agent-status-input-resolution") continue;
			if (!unresolvedRequest || !isInputResolution(entry.data) || entry.data.toolCallId !== unresolvedRequest.toolCallId) continue;
			const isResolved = branch.some((child) =>
				child.parentId === entry.id && child.type === "message" && child.message.role === "user");
			if (isResolved) unresolvedRequest = undefined;
		}
		if (unresolvedRequest) ctx.ui.setStatus("agent-status", "Needs input");
	});

	pi.on("agent_start", (_event, ctx) => {
		ctx.ui.setStatus("agent-status", undefined);
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (unresolvedRequest) ctx.ui.setStatus("agent-status", "Needs input");
	});

	pi.on("input", (event) => {
		if (event.source !== "interactive" || event.text.trim().length === 0 || !unresolvedRequest) return;
		pi.appendEntry<InputResolution>("agent-status-input-resolution", {
			toolCallId: unresolvedRequest.toolCallId,
		});
		unresolvedRequest = undefined;
		return { action: "continue" };
	});
}

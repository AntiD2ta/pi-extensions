import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { StopReason } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

import { createUnresolvedInputState, type InputRequest } from "./input-state.ts";

const requestUserInputParameters = Type.Object({
	context: Type.String({ minLength: 1, description: "Context needed to make the decision" }),
	question: Type.String({ minLength: 1, description: "Precise question for the user" }),
	recommendedAnswer: Type.String({ minLength: 1, description: "Recommended answer" }),
	rationale: Type.String({ minLength: 1, description: "Why this answer is recommended" }),
});

type AgentState = "Ready" | "Running" | "Needs input" | "Completed" | "Failed" | "Interrupted";

function widgetColor(state: AgentState): "accent" | "warning" | "error" {
	switch (state) {
		case "Needs input": return "warning";
		case "Failed":
		case "Interrupted": return "error";
		default: return "accent";
	}
}

function renderState(ctx: ExtensionContext, state: AgentState) {
	if (ctx.mode !== "tui") return;
	if (state === "Running") {
		ctx.ui.setWidget("agent-status", undefined);
		return;
	}
	const label = ctx.ui.theme.fg(widgetColor(state), state);
	ctx.ui.setWidget("agent-status", [state === "Needs input" ? ctx.ui.theme.bg("toolPendingBg", label) : label]);
}

export default function (pi: ExtensionAPI) {
	const inputState = createUnresolvedInputState(pi);
	let presentationState: AgentState = "Ready";
	let latestStopReason: StopReason | undefined;

	const setPresentationState = (ctx: ExtensionContext, next: AgentState) => {
		presentationState = next;
		renderState(ctx, presentationState);
	};

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
			const request = inputState.requestInput(toolCallId, params);
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
		inputState.restore(ctx);
		inputState.onUnresolvedInputChange(() => {
			if (!inputState.isUnresolved() && presentationState !== "Running") {
				setPresentationState(ctx, "Ready");
			}
		});
		setPresentationState(ctx, inputState.isUnresolved() ? "Needs input" : "Ready");
	});

	pi.on("agent_start", (_event, ctx) => {
		latestStopReason = undefined;
		setPresentationState(ctx, "Running");
	});

	pi.on("agent_end", (event) => {
		const assistant = [...event.messages].reverse().find((message) => message.role === "assistant");
		latestStopReason = assistant?.stopReason;
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (inputState.isUnresolved()) {
			setPresentationState(ctx, "Needs input");
			return;
		}
		setPresentationState(ctx, latestStopReason === "aborted"
			? "Interrupted"
			: latestStopReason === "error" ? "Failed" : "Completed");
	});

	pi.on("input", (event, ctx) => {
		if (event.source !== "interactive" || event.text.trim().length === 0) return;
		if (inputState.resolveInput()) {
			return { action: "continue" };
		}
		if (presentationState === "Completed" || presentationState === "Failed" || presentationState === "Interrupted") {
			setPresentationState(ctx, "Ready");
		}
		return { action: "continue" };
	});
}

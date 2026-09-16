import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	type Context,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const inputRequest = {
	context: "The visual trial needs to demonstrate the waiting state.",
	question: "Which database should the trial use?",
	recommendedAnswer: "PostgreSQL",
	rationale: "It produces a deterministic free-text reply for the trial.",
};

function latestUserText(context: Context) {
	const message = [...context.messages].reverse().find((candidate) => candidate.role === "user");
	if (!message) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("\n");
}

function scriptedResponse(context: Context) {
	const prompt = latestUserText(context).toLowerCase();
	if (prompt.includes("needs input")) {
		return fauxAssistantMessage(
			fauxToolCall("request_user_input", inputRequest, { id: "visual-input-request" }),
			{ stopReason: "toolUse" },
		);
	}
	if (prompt.includes("fail")) {
		return fauxAssistantMessage("", {
			stopReason: "error",
			errorMessage: "Synthetic visual trial failure.",
		});
	}
	if (prompt.includes("slow")) {
		return fauxAssistantMessage(
			"Slow faux response in progress. ".repeat(12) + "The slow faux response completed.",
		);
	}
	return fauxAssistantMessage("The faux response completed.");
}

export default function (pi: ExtensionAPI) {
	const faux = fauxProvider({
		provider: "pi-agent-status-visual",
		models: [{ id: "visual-model", name: "Status Visual Trial" }],
		tokensPerSecond: 4,
		tokenSize: { min: 1, max: 1 },
	});
	faux.setResponses(Array.from({ length: 32 }, () => scriptedResponse));
	pi.registerProvider(faux.provider);
}

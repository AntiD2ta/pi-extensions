import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI): void {
	const faux = fauxProvider({
		provider: "pi-tool-display-trial",
		models: [{ id: "mutation", name: "Tool-display mutation trial", reasoning: false }],
	});
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("write", { path: "notes.ts", content: "export const status = 'draft';\n" }),
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage(
			fauxToolCall("edit", {
				path: "notes.ts",
				oldText: "export const status = 'draft';",
				newText: "export const status = 'ready';",
			}),
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage(fauxText("Mutation trial complete.")),
	]);
	pi.registerProvider(faux.provider);
}

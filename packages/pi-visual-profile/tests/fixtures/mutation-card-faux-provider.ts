import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const TRIAL_MODEL = "pi-34-trial/mutation-card";

export default function (pi: ExtensionAPI) {
	const faux = fauxProvider({
		provider: "pi-34-trial",
		models: [{ id: "mutation-card", name: "PI-34 mutation-card trial" }],
		tokensPerSecond: 20,
		tokenSize: { min: 1, max: 1 },
	});
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("edit", {
				path: "notes.ts",
				edits: [{
					oldText: [
						"export const notes = [",
						'\t"inspect the pending card",',
						'\t"confirm semantic rows",',
						'\t"confirm settled state",',
						"] as const;",
					].join("\n"),
					newText: [
						"export const notes = [",
						'\t"inspect the settled mutation card",',
						'\t"confirm the hunk label",',
						'\t"confirm added and removed backgrounds",',
						'\t"confirm semantic row prefixes",',
						'\t"confirm there is no duplicate preview",',
						"] as const;",
					].join("\n"),
				}],
			}),
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage("The scripted edit is complete. The trial remains open for visual inspection."),
		fauxAssistantMessage("Steering received. The mutation remains limited to notes.ts."),
	]);
	pi.registerProvider(faux.provider);
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI) {
	const faux = fauxProvider({
		tokensPerSecond: 2,
		provider: "pi-visual-profile-faux",
		models: [{ id: "scripted", name: "Visual-profile scripted test model", reasoning: false }],
	});
	faux.setResponses([
		fauxAssistantMessage(fauxText("First faux response.")),
		fauxAssistantMessage(fauxText("Second faux response.")),
		fauxAssistantMessage(fauxText("Third faux response.")),
	]);
	pi.registerProvider(faux.provider);
}

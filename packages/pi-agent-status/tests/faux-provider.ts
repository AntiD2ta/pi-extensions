import { fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export function createTestFauxProvider() {
	const faux = fauxProvider({
		provider: "pi-agent-status-test",
		models: [{ id: "test-model" }],
	});
	const extension: ExtensionFactory = (pi) => {
		pi.registerProvider(faux.provider);
	};
	return { extension, faux };
}

import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fauxProviderExtension from "./faux-provider.ts";

test("faux provider registers an offline scripted model", () => {
	let providerId: string | undefined;
	const pi = {
		registerProvider(provider: { id: string }) {
			providerId = provider.id;
		},
	} as unknown as ExtensionAPI;

	fauxProviderExtension(pi);

	assert.equal(providerId, "pi-visual-profile-faux");
});

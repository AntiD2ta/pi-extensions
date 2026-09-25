import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import imageMarkers from "../index.ts";

test("enables image markers in interactive sessions when the fork API is available", () => {
	let enable: ((event: object, ctx: object) => void) | undefined;
	const pi = { on(_event: string, handler: typeof enable) { enable = handler; } };
	imageMarkers(pi as unknown as ExtensionAPI);
	let enabled = false;
	enable?.({}, { mode: "tui", ui: { setImageMarkersEnabled(value: boolean) { enabled = value; } } });
	assert.equal(enabled, true);
});

test("warns on public Pi without changing clipboard behavior", () => {
	let enable: ((event: object, ctx: object) => void) | undefined;
	imageMarkers({ on(_event: string, handler: typeof enable) { enable = handler; } } as unknown as ExtensionAPI);
	let warning = "";
	enable?.({}, { mode: "tui", ui: { notify(message: string) { warning = message; } } });
	assert.match(warning, /AntiD2ta\/pi/);
});

import { describe, expect, it } from "vitest";
import { applyVisualProfilePresentation } from "../visual-profile-presentation.ts";

const profile = { style: "boxed" as const, borderStyle: "rounded" as const, glyphMode: "unicode" as const, padding: 1 as const };

describe("visual-profile presentation protocol", () => {
	it("acquires, reports, and releases the adapter-owned presentation", () => {
		const acquired = applyVisualProfilePresentation(undefined, { version: 1, owner: "pi-visual-profile", action: "acquire", profile });
		expect(acquired).toMatchObject({ owner: "pi-visual-profile", profile, result: { supported: true, accepted: true } });
		const blocked = applyVisualProfilePresentation(acquired.owner, { version: 1, owner: "other", action: "acquire", profile });
		expect(blocked.result).toEqual({ supported: true, accepted: false, owner: "pi-visual-profile" });
		const released = applyVisualProfilePresentation(acquired.owner, { version: 1, owner: "pi-visual-profile", action: "release" });
		expect(released).toMatchObject({ owner: undefined, profile: undefined, result: { supported: true, accepted: true } });
	});
});

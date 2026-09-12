import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../config.ts";
import { describeMcpPresentation, formatDoctor } from "../doctor.ts";

test("doctor describes unavailable, competing, and released MCP presentation", () => {
	assert.equal(describeMcpPresentation(true, undefined), "adapter unavailable");
	assert.equal(describeMcpPresentation(true, { supported: true, accepted: false, owner: "other-profile" }), "owned by other-profile");
	assert.equal(describeMcpPresentation(false, { supported: true, accepted: true }), "adapter native rendering");
});

test("doctor renders configuration in readable sections", () => {
	assert.equal(formatDoctor({
		scope: "project overrides global",
		config: { ...DEFAULT_CONFIG, enabled: true, glyphMode: "ascii" },
		darkThemeAvailable: true,
		lightThemeAvailable: false,
		nativeFenceChromeAvailable: true,
		nativeEditorPaddingAvailable: false,
		nativeThemeOverrideAvailable: true,
		globalPath: "/tmp/agent/visual-profile/config.json",
		projectPath: "/work/project/.pi/visual-profile/config.json",
		mcpPresentation: "profile boxed rendering active",
		toolRendererProfileSupported: false,
	}), [
		"Visual profile doctor",
		"",
		"Scope",
		"  project overrides global",
		"",
		"Configuration",
		"  enabled: yes",
		"  theme: profile",
		"  glyphs: ascii",
		"  border: rounded",
		"  padding: 1",
		"  tool cards: boxed",
		"  diff layout: stacked",
		"",
		"Themes",
		"  pi-visual-profile-dark: available",
		"  pi-visual-profile-light: unavailable",
		"",
		"Compatibility",
		"  footer: never claimed",
		"  native fence chrome: available",
		"  native editor padding: unavailable",
		"  native theme override: available",
		"  editor border glyphs: unavailable (native Pi API gap)",
		"  MCP presentation: profile boxed rendering active",
		"  tool renderer profile: unavailable",
		"  unsupported surfaces: native Pi rendering",
		"",
		"Configuration files",
		"  global: /tmp/agent/visual-profile/config.json",
		"  project: /work/project/.pi/visual-profile/config.json",
	].join("\n"));
});

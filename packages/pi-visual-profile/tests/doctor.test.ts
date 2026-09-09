import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../config.ts";
import { formatDoctor } from "../doctor.ts";

test("doctor renders configuration in readable sections", () => {
	assert.equal(formatDoctor({
		scope: "project overrides global",
		config: { ...DEFAULT_CONFIG, enabled: true, glyphMode: "ascii" },
		darkThemeAvailable: true,
		lightThemeAvailable: false,
		globalPath: "/tmp/agent/visual-profile/config.json",
		projectPath: "/work/project/.pi/visual-profile/config.json",
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
		"  separator: chevron",
		"  padding: 1",
		"  footer rows: 2",
		"  usage window: 5 hours",
		"  tool cards: boxed",
		"",
		"Themes",
		"  pi-visual-profile-dark: available",
		"  pi-visual-profile-light: unavailable",
		"",
		"Compatibility",
		"  footer override: supported",
		"  unsupported surfaces: native Pi rendering",
		"",
		"Configuration files",
		"  global: /tmp/agent/visual-profile/config.json",
		"  project: /work/project/.pi/visual-profile/config.json",
	].join("\n"));
});

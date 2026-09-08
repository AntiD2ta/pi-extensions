import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG, loadConfig, parseConfig, saveConfig } from "../config.ts";

test("project configuration overrides only the fields it sets", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const globalPath = join(directory, "global.json");
	const projectPath = join(directory, "project.json");
	writeFileSync(globalPath, JSON.stringify({ enabled: true, glyphMode: "ascii", footerRows: 3 }));
	writeFileSync(projectPath, JSON.stringify({ glyphMode: "not-a-mode", borderStyle: "sharp" }));

	assert.deepEqual(loadConfig(globalPath, projectPath), {
		...DEFAULT_CONFIG,
		enabled: true,
		glyphMode: "ascii",
		borderStyle: "sharp",
		footerRows: 3,
	});
});

test("saving configuration keeps existing valid fields", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const configPath = join(directory, "config.json");
	writeFileSync(configPath, JSON.stringify({ enabled: true, glyphMode: "ascii" }));

	assert.equal(saveConfig(configPath, { borderStyle: "sharp" }), true);
	assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
		enabled: true,
		glyphMode: "ascii",
		borderStyle: "sharp",
	});
});

test("configuration preserves valid fields when another field is malformed", () => {
	const config = parseConfig({
		enabled: true,
		glyphMode: "ascii",
		borderStyle: "not-a-border",
		footerRows: 3,
	});

	assert.deepEqual(config, {
		...DEFAULT_CONFIG,
		enabled: true,
		glyphMode: "ascii",
		footerRows: 3,
	});
});

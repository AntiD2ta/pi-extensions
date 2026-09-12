import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import visualProfile from "../index.ts";
import { DEFAULT_CONFIG, loadConfig, parseConfig, saveConfig } from "../config.ts";

test("an unknown key in an existing configuration is ignored, not rejected", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const globalPath = join(directory, "global.json");
	writeFileSync(globalPath, JSON.stringify({ enabled: true, footerRows: 3, separatorStyle: "dot" }));

	assert.deepEqual(loadConfig(globalPath), { ...DEFAULT_CONFIG, enabled: true });
});

test("project configuration overrides only the fields it sets", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const globalPath = join(directory, "global.json");
	const projectPath = join(directory, "project.json");
	writeFileSync(globalPath, JSON.stringify({ enabled: true, glyphMode: "ascii", padding: 2 }));
	writeFileSync(projectPath, JSON.stringify({ glyphMode: "not-a-mode", borderStyle: "sharp" }));

	assert.deepEqual(loadConfig(globalPath, projectPath), {
		...DEFAULT_CONFIG,
		enabled: true,
		glyphMode: "ascii",
		borderStyle: "sharp",
		padding: 2,
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

test("configuration accepts a tool card style", () => {
	assert.deepEqual(parseConfig({ toolCardStyle: "minimal" }), {
		...DEFAULT_CONFIG,
		toolCardStyle: "minimal",
	});
});

test("configuration accepts and persists the selected diff layout", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const configPath = join(directory, "config.json");

	assert.equal(saveConfig(configPath, { diffLayout: "side-by-side" }), true);
	assert.equal(loadConfig(configPath).diffLayout, "side-by-side");
});

test("diff command persists the selected local layout", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	const previousHome = process.env.HOME;
	process.env.HOME = directory;
	t.after(() => {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		rmSync(directory, { recursive: true, force: true });
	});
	let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
	visualProfile({
		on() {},
		registerCommand(_name: string, definition: { handler(args: string, ctx: unknown): Promise<void> }) { command = definition; },
		events: { emit() {} },
	} as unknown as ExtensionAPI);
	const notifications: string[] = [];
	const context = {
		cwd: directory,
		mode: "tui",
		isProjectTrusted: () => true,
		ui: { notify(message: string) { notifications.push(message); }, getAllThemes: () => [], theme: {} },
	};

	await command?.handler("diff side-by-side --local", context);

	assert.equal(loadConfig(join(directory, ".pi", "visual-profile", "config.json")).diffLayout, "side-by-side");
	assert.match(notifications.join("\n"), /Diff layout set to side-by-side locally/);
});

test("configuration preserves valid fields when another field is malformed", () => {
	const config = parseConfig({
		enabled: true,
		glyphMode: "ascii",
		borderStyle: "not-a-border",
		padding: 2,
	});

	assert.deepEqual(config, {
		...DEFAULT_CONFIG,
		enabled: true,
		glyphMode: "ascii",
		padding: 2,
	});
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import visualProfile from "../index.ts";

type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void> | void;
type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => void;

test("the profile never claims the footer, enabled or not", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-visual-profile-home-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = home;
	process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
	t.after(() => {
		process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(home, { recursive: true, force: true });
	});

	const footerCalls: string[] = [];
	const notifications: string[] = [];
	let sessionStart: SessionStartHandler | undefined;
	let command: CommandHandler | undefined;
	const pi = {
		on(event: string, handler: SessionStartHandler) {
			if (event === "session_start") sessionStart = handler;
		},
		registerCommand(_name: string, definition: { handler: CommandHandler }) {
			command = definition.handler;
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd: home,
		mode: "tui",
		isProjectTrusted: () => false,
		ui: {
			setFooter: () => footerCalls.push("setFooter"),
			notify: (message: string) => notifications.push(message),
			getAllThemes: () => [],
		},
	} as unknown as ExtensionContext;

	visualProfile(pi);
	assert.ok(command, "the extension registers /visual-profile");
	await command("enable", ctx);
	sessionStart?.({}, ctx);
	await command("glyph ascii", ctx);
	const enabledDoctor = notifications.length;
	await command("doctor", ctx);
	await command("disable", ctx);

	assert.deepEqual(footerCalls, []);
	assert.deepEqual(notifications.filter((_, index) => index !== enabledDoctor), [
		"Visual profile enabled globally.",
		"Glyph mode set to ascii globally.",
		"Visual profile disabled globally.",
	]);
	assert.match(notifications[enabledDoctor] ?? "", /\n  footer: never claimed\n/);
	assert.match(notifications[enabledDoctor] ?? "", /\n  visible surfaces: none yet, enabling only stores configuration\n/);
});

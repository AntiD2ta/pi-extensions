import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	type AutocompleteProvider,
	type Editor,
	type EditorTheme,
	type TUI,
} from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;
type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => void;

type MarkdownCodeFenceChrome = {
	header: (options: { language?: string; path?: string; width: number }) => string[];
	body: (lines: string[]) => string[];
	closing: () => string[];
};

function createExtensionHarness(
	nativeSurfaceOverrides: "present" | "invalid" | "missing" = "present",
	themeName = "light",
	mode: ExtensionContext["mode"] = "tui",
	profileThemesAvailable = true,
) {
	let sessionStart: SessionStartHandler | undefined;
	let sessionShutdown: (() => void) | undefined;
	let command: CommandHandler | undefined;
	const chromeCalls: Array<MarkdownCodeFenceChrome | undefined> = [];
	const themeCalls: Array<string | undefined> = [];
	const editorCalls: Array<unknown> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	let footerCalls = 0;
	const extension = {
		events: { emit: () => undefined },
		on(event: string, handler: SessionStartHandler | (() => void)) {
			if (event === "session_start") sessionStart = handler as SessionStartHandler;
			if (event === "session_shutdown") sessionShutdown = handler as () => void;
		},
		registerCommand(_name: string, definition: { handler: CommandHandler }) {
			command = definition.handler;
		},
	} as unknown as ExtensionAPI;
	const context = {
		cwd: "/work/project",
		mode,
		isProjectTrusted: () => false,
		ui: {
			setFooter: () => {
				footerCalls++;
			},
			...(nativeSurfaceOverrides === "present" ? {
				setMarkdownCodeFenceChromeOverride(_owner: object, chrome: MarkdownCodeFenceChrome | undefined) {
					chromeCalls.push(chrome);
				},
				setThemeOverride(_owner: object, theme: string | undefined) {
					themeCalls.push(theme);
				},
				setEditorComponentOverride(_owner: object, factory: unknown) {
					editorCalls.push(factory);
				},
			} : nativeSurfaceOverrides === "invalid" ? {
				setMarkdownCodeFenceChromeOverride: true,
				setThemeOverride: true,
				setEditorComponentOverride: true,
			} : {}),
			theme: { name: themeName },
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
			getAllThemes: () => profileThemesAvailable
				? [{ name: "pi-visual-profile-dark" }, { name: "pi-visual-profile-light" }]
				: [],
		},
	} as unknown as ExtensionContext;
	return {
		extension,
		context,
		chromeCalls,
		themeCalls,
		editorCalls,
		notifications,
		get footerCalls() {
			return footerCalls;
		},
		start() {
			assert.ok(sessionStart, "extension must register a session_start handler");
			sessionStart({}, context);
		},
		shutdown() {
			assert.ok(sessionShutdown, "extension must register a session_shutdown handler");
			sessionShutdown();
		},
		async runCommand(args: string) {
			assert.ok(command, "extension must register its command");
			await command(args, context);
		},
	};
}

test("enabled profile claims native code-fence chrome and disablement releases it", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = home;
	delete process.env.PI_CODING_AGENT_DIR;
	t.after(() => {
		process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(home, { recursive: true, force: true });
	});
	const configPath = join(home, ".pi", "agent", "visual-profile", "config.json");
	mkdirSync(join(home, ".pi", "agent", "visual-profile"), { recursive: true });
	writeFileSync(configPath, JSON.stringify({ enabled: true }));

	const { default: install } = await import(`../index.ts?${Date.now()}`);
	const harness = createExtensionHarness();
	install(harness.extension);
	harness.start();

	assert.equal(harness.footerCalls, 0);
	assert.equal(harness.chromeCalls.length, 1);
	assert.ok(harness.chromeCalls[0]);
	assert.deepEqual(harness.themeCalls, ["pi-visual-profile-light"]);
	assert.equal(harness.editorCalls.length, 1);
	assert.equal(typeof harness.editorCalls[0], "function");
	assert.match(harness.chromeCalls[0].header({ language: "typescript", width: 80 }).join("\n"), /typescript/);

	await harness.runCommand("disable");
	assert.deepEqual(harness.chromeCalls, [harness.chromeCalls[0], undefined]);
	assert.deepEqual(harness.themeCalls, ["pi-visual-profile-light", undefined]);
	assert.deepEqual(harness.editorCalls, [harness.editorCalls[0], undefined]);

	await harness.runCommand("enable");
	harness.shutdown();
	assert.equal(harness.chromeCalls.at(-1), undefined);
	assert.equal(harness.themeCalls.at(-1), undefined);
	assert.equal(harness.editorCalls.at(-1), undefined);
});

test("surface-only settings keep the active editor instance", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = home;
	delete process.env.PI_CODING_AGENT_DIR;
	t.after(() => {
		process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(home, { recursive: true, force: true });
	});
	const configPath = join(home, ".pi", "agent", "visual-profile", "config.json");
	mkdirSync(join(home, ".pi", "agent", "visual-profile"), { recursive: true });
	writeFileSync(configPath, JSON.stringify({ enabled: true }));

	const { default: install } = await import(`../index.ts?${Date.now()}`);
	const harness = createExtensionHarness();
	install(harness.extension);
	harness.start();
	const editor = harness.editorCalls[0];
	await harness.runCommand("glyph ascii");
	await harness.runCommand("inherit");

	assert.deepEqual(harness.editorCalls, [editor]);
});

test("profile chooses the matching dark theme", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = home;
	delete process.env.PI_CODING_AGENT_DIR;
	t.after(() => {
		process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(home, { recursive: true, force: true });
	});
	const configPath = join(home, ".pi", "agent", "visual-profile", "config.json");
	mkdirSync(join(home, ".pi", "agent", "visual-profile"), { recursive: true });
	writeFileSync(configPath, JSON.stringify({ enabled: true }));

	const { default: install } = await import(`../index.ts?${Date.now()}`);
	const harness = createExtensionHarness("present", "dark");
	install(harness.extension);
	harness.start();

	assert.deepEqual(harness.themeCalls, ["pi-visual-profile-dark"]);
});

test("profile leaves the selected theme native when profile themes are unavailable", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = home;
	delete process.env.PI_CODING_AGENT_DIR;
	t.after(() => {
		process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(home, { recursive: true, force: true });
	});
	const configPath = join(home, ".pi", "agent", "visual-profile", "config.json");
	mkdirSync(join(home, ".pi", "agent", "visual-profile"), { recursive: true });
	writeFileSync(configPath, JSON.stringify({ enabled: true }));

	const { default: install } = await import(`../index.ts?${Date.now()}`);
	const harness = createExtensionHarness("present", "light", "tui", false);
	install(harness.extension);
	harness.start();

	assert.deepEqual(harness.themeCalls, []);
	assert.equal(harness.chromeCalls.length, 1);
	assert.equal(harness.editorCalls.length, 1);
});

test("profile fence chrome keeps highlighted code and omits narrow labels", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = home;
	delete process.env.PI_CODING_AGENT_DIR;
	t.after(() => {
		process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(home, { recursive: true, force: true });
	});
	const configPath = join(home, ".pi", "agent", "visual-profile", "config.json");
	mkdirSync(join(home, ".pi", "agent", "visual-profile"), { recursive: true });
	writeFileSync(configPath, JSON.stringify({ enabled: true, glyphMode: "ascii" }));

	const { default: install } = await import(`../index.ts?${Date.now()}`);
	const harness = createExtensionHarness();
	install(harness.extension);
	harness.start();
	const chrome = harness.chromeCalls[0];
	assert.ok(chrome);
	const highlighted = "\x1b[31mconst answer = 42;\x1b[0m";
	const wide = [...chrome.header({ language: "typescript", width: 80 }), ...chrome.body([highlighted]), ...chrome.closing()].join("\n");
	assert.match(wide, /typescript/);
	assert.match(wide, /\+-/);
	assert.doesNotMatch(wide, /[^\x00-\x7F]/);
	assert.match(wide, /\x1b\[31mconst answer = 42;\x1b\[0m/);

	const narrow = chrome.header({ language: "typescript", width: 8 }).join("\n");
	assert.doesNotMatch(narrow, /typescript/);
});

test("profile editor retains native input interactions after Pi applies default padding", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = home;
	delete process.env.PI_CODING_AGENT_DIR;
	t.after(() => {
		process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(home, { recursive: true, force: true });
	});
	const configPath = join(home, ".pi", "agent", "visual-profile", "config.json");
	mkdirSync(join(home, ".pi", "agent", "visual-profile"), { recursive: true });
	writeFileSync(configPath, JSON.stringify({ enabled: true, padding: 2 }));

	const { default: install } = await import(`../index.ts?${Date.now()}`);
	const harness = createExtensionHarness();
	install(harness.extension);
	harness.start();
	const factory = harness.editorCalls[0] as (tui: TUI, theme: EditorTheme, keybindings: unknown) => Editor;
	const tui = { terminal: { rows: 24 }, requestRender() {} } as unknown as TUI;
	const theme: EditorTheme = {
		borderColor: (text) => text,
		selectList: {
			selectedPrefix: (text) => text,
			selectedText: (text) => text,
			description: (text) => text,
			scrollInfo: (text) => text,
			noMatch: (text) => text,
		},
	};
	const editor = factory(tui, theme, { matches: () => false });
	assert.equal(editor.getPaddingX(), 2);
	editor.setPaddingX(0);
	assert.equal(editor.getPaddingX(), 2);

	editor.handleInput("a");
	editor.handleInput("\x1b[13;2u");
	editor.handleInput("b");
	assert.equal(editor.getText(), "a\nb");
	assert.deepEqual(editor.getCursor(), { line: 1, col: 1 });
	editor.handleInput("\x1b[200~ paste\x1b[201~");
	assert.equal(editor.getText(), "a\nb paste");

	editor.addToHistory("previous prompt");
	editor.setText("");
	editor.render(80);
	editor.handleInput("\x1b[A");
	assert.equal(editor.getText(), "previous prompt");

	const mouseEditor = editor as Editor & {
		handleMouse?: (event: {
			type: "click";
			button: "left";
			x: number;
			y: number;
			screenX: number;
			screenY: number;
			width: number;
			height: number;
			shift: boolean;
			alt: boolean;
			ctrl: boolean;
			clickCount: number;
		}) => void;
	};
	if (typeof mouseEditor.handleMouse === "function") {
		editor.setText("hello");
		editor.render(80);
		mouseEditor.handleMouse({
			type: "click",
			button: "left",
			x: 4,
			y: 1,
			screenX: 4,
			screenY: 1,
			width: 80,
			height: 10,
			shift: false,
			alt: false,
			ctrl: false,
			clickCount: 1,
		});
		editor.handleInput("X");
		assert.equal(editor.getText(), "heXllo");
	}

	const autocomplete: AutocompleteProvider = {
		async getSuggestions() {
			return {
				prefix: "he",
				items: [
					{ value: "hello", label: "hello" },
					{ value: "help", label: "help" },
				],
			};
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const line = lines[cursorLine] ?? "";
			return {
				lines: [...lines.slice(0, cursorLine), line.slice(0, cursorCol - prefix.length) + item.value + line.slice(cursorCol), ...lines.slice(cursorLine + 1)],
				cursorLine,
				cursorCol: cursorCol - prefix.length + item.value.length,
			};
		},
	};
	editor.setAutocompleteProvider(autocomplete);
	editor.setText("he");
	editor.handleInput("\t");
	await Promise.resolve();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(editor.isShowingAutocomplete(), true);
	editor.handleInput("\t");
	assert.equal(editor.getText(), "hello");
});

test("doctor reports available native surface capabilities", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = home;
	delete process.env.PI_CODING_AGENT_DIR;
	t.after(() => {
		process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(home, { recursive: true, force: true });
	});

	const { default: install } = await import(`../index.ts?${Date.now()}`);
	const harness = createExtensionHarness();
	install(harness.extension);
	harness.start();
	await harness.runCommand("doctor");

	assert.match(harness.notifications.at(-1)?.message ?? "", /native fence chrome: available/);
	assert.match(harness.notifications.at(-1)?.message ?? "", /native editor padding: available/);
	assert.match(harness.notifications.at(-1)?.message ?? "", /native theme override: available/);
});

test("non-TUI runs leave native surfaces unchanged", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = home;
	delete process.env.PI_CODING_AGENT_DIR;
	t.after(() => {
		process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(home, { recursive: true, force: true });
	});
	const configPath = join(home, ".pi", "agent", "visual-profile", "config.json");
	mkdirSync(join(home, ".pi", "agent", "visual-profile"), { recursive: true });
	writeFileSync(configPath, JSON.stringify({ enabled: true }));

	const { default: install } = await import(`../index.ts?${Date.now()}`);
	const harness = createExtensionHarness("present", "light", "print");
	install(harness.extension);
	harness.start();
	assert.deepEqual(harness.chromeCalls, []);
	assert.deepEqual(harness.editorCalls, []);
	assert.deepEqual(harness.themeCalls, []);
	await harness.runCommand("doctor");
	assert.match(harness.notifications.at(-1)?.message ?? "", /native fence chrome: unavailable/);
});

test("unavailable native surface APIs leave the profile native", async (t) => {
	const home = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = home;
	delete process.env.PI_CODING_AGENT_DIR;
	t.after(() => {
		process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(home, { recursive: true, force: true });
	});
	const configPath = join(home, ".pi", "agent", "visual-profile", "config.json");
	mkdirSync(join(home, ".pi", "agent", "visual-profile"), { recursive: true });
	writeFileSync(configPath, JSON.stringify({ enabled: true }));

	for (const nativeSurfaceOverrides of ["invalid", "missing"] as const) {
		const { default: install } = await import(`../index.ts?${Date.now()}-${nativeSurfaceOverrides}`);
		const harness = createExtensionHarness(nativeSurfaceOverrides);
		install(harness.extension);
		assert.doesNotThrow(() => harness.start());
		assert.deepEqual(harness.chromeCalls, []);
		assert.deepEqual(harness.editorCalls, []);
		assert.deepEqual(harness.themeCalls, []);
		await harness.runCommand("doctor");
		assert.match(harness.notifications.at(-1)?.message ?? "", /native fence chrome: unavailable/);
	}
});

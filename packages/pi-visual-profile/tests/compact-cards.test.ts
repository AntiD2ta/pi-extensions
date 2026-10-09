import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, Text } from "@earendil-works/pi-tui";
import visualProfile from "../index.ts";
import { createCompactRenderers, rendererChoice, type ToolRenderers } from "../compact-cards.ts";

const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;
const ownRenderer: ToolRenderers = { renderCall: () => new Text("owner call", 0, 0), renderResult: () => new Text("owner result", 0, 0) };

function context(overrides: Record<string, unknown> = {}) {
	return {
		args: {},
		toolCallId: "call-1",
		invalidate() {},
		lastComponent: undefined,
		state: {},
		cwd: "/work",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		outputPad: 0,
		...overrides,
	};
}

/** Renders a row the way Pi stacks a self-rendered tool: call, then result. */
function renderRow(toolName: string, args: Record<string, unknown>, text: string, overrides: Record<string, unknown> = {}, details?: unknown, owner?: ToolRenderers): string[] {
	const renderers = createCompactRenderers(toolName, owner, "unicode");
	const ctx = context({ args, ...overrides });
	const call = renderers.renderCall!(args, theme, ctx as never);
	const result = renderers.renderResult!(
		{ content: [{ type: "text", text }], details },
		{ expanded: Boolean(ctx.expanded), isPartial: ctx.isPartial },
		theme,
		ctx as never,
	);
	return [...call.render(100), ...result.render(100)].map((line) => stripTerminalSequences(line).trimEnd());
}

test("tools default to compact unless another extension draws them", () => {
	assert.equal(rendererChoice("bash", ownRenderer, {}), "compact");
	assert.equal(rendererChoice("web_search", ownRenderer, {}), "compact");
	assert.equal(rendererChoice("edit", ownRenderer, {}), "compact");
	assert.equal(rendererChoice("run_experiment", ownRenderer, {}), "owner");
	assert.equal(rendererChoice("request_user_input", ownRenderer, {}), "owner");
	assert.equal(rendererChoice("peek_main", undefined, {}), "compact");
	assert.equal(rendererChoice("bash", ownRenderer, { bash: "owner" }), "owner");
	assert.equal(rendererChoice("edit", ownRenderer, { edit: "owner" }), "owner");
});

test("a shell card shows the command, the last output lines, and how many are hidden", () => {
	const output = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n");

	const lines = renderRow("bash", { command: "git log --oneline" }, output, { durationMs: 420 });

	assert.deepEqual(lines.slice(0, 4), ["• Ran git log --oneline · 420ms", "  └ line 8", "    line 9", "    line 10"]);
	// The expand key name comes from Pi's keybindings, which tests do not load.
	assert.match(lines[4], /^ {4}\+ 7 lines \(/);
});

test("the collapsed preview skips blank lines", () => {
	const lines = renderRow("read", { path: "a.md" }, "one\n\ntwo\n\nthree\n\nfour");

	assert.deepEqual(lines.slice(1, 4), ["  └ two", "    three", "    four"]);
	assert.match(lines[4], /^ {4}\+ 4 lines/);
});

test("a failed shell card names the exit code and drops Pi's status line", () => {
	const lines = renderRow("bash", { command: "make" }, "error: boom\n\nCommand exited with code 3", { isError: true });

	assert.deepEqual(lines, ["• Failed (exit 3) make", "  └ error: boom"]);
});

test("a multi-line command collapses to its first line until expanded", () => {
	const args = { command: "cd repo\nnpm test\nnpm run build" };

	assert.equal(renderRow("bash", args, "")[0], "• Ran cd repo · +2 lines");
	assert.deepEqual(renderRow("bash", args, "", { expanded: true }), ["• Ran cd repo", "  npm test", "  npm run build"]);
});

test("file and web tools describe what they did", () => {
	assert.equal(renderRow("read", { path: "src/index.ts" }, "x")[0], "• Read src/index.ts");
	assert.equal(renderRow("grep", { pattern: "TODO", path: "src" }, "x")[0], "• Search TODO in src");
	assert.equal(renderRow("ls", {}, "x")[0], "• List .");
	assert.equal(renderRow("web_search", { queries: ["a", "b"] }, "x")[0], "• Searched web 2 queries");
	assert.equal(renderRow("fetch_content", { url: "https://example.com" }, "x")[0], "• Fetched https://example.com");
	assert.equal(renderRow("peek_main", { question: "status?" }, "x")[0], "• peek_main status?");
});

test("each kind of tool has its own verb color, and targets are highlighted", () => {
	const recording = { fg: (color: string, text: string) => `<${color}>${text}</>`, bold: (text: string) => text } as unknown as Theme;
	const header = (toolName: string, args: Record<string, unknown>) => {
		const renderers = createCompactRenderers(toolName, undefined, "unicode");
		return renderers.renderCall!(args, recording, context({ args }) as never).render(200)[0];
	};

	assert.equal(header("grep", { pattern: "TODO", path: "src" }), "<success>•</> <syntaxFunction>Search</> <mdCode>TODO</> <muted>in</> <mdLinkUrl>src</>");
	assert.match(header("read", { path: "a.ts" }), /<mdHeading>Read<\/> <mdLinkUrl>a\.ts<\/>/);
	assert.match(header("bash", { command: "ls" }), /<accent>Ran<\/>/);
	assert.match(header("web_search", { query: "pi" }), /<syntaxType>Searched web<\/> <syntaxString>"pi"<\/>/);
	assert.match(header("codemode", { code: "x" }), /<syntaxOperator>codemode<\/>/);
});

test("a failed call turns the verb red for every tool", () => {
	const recording = { fg: (color: string, text: string) => `<${color}>${text}</>`, bold: (text: string) => text } as unknown as Theme;
	const header = (toolName: string, args: Record<string, unknown>) =>
		createCompactRenderers(toolName, undefined, "unicode").renderCall!(args, recording, context({ args, isError: true }) as never).render(200)[0];

	assert.match(header("read", { path: "a.ts" }), /<error>Read<\/>/);
	assert.match(header("fetch_content", { url: "https://x" }), /<error>Fetched<\/>/);
	assert.match(header("codemode", { code: "x" }), /<error>codemode<\/>/);
});

test("an edit card has a compact header over the owner's diff without its summary row", () => {
	const owner: ToolRenderers = {
		renderCall: () => new Text("edit notes.ts", 0, 0),
		renderResult: () => new Text("↳ diff +2 -1 split\n- old\n+ new\n+ more", 0, 0),
	};

	assert.deepEqual(renderRow("edit", { path: "notes.ts" }, "ok", {}, undefined, owner), [
		"• Edited notes.ts (+2 -1)",
		"  - old",
		"  + new",
		"  + more",
	]);
});

test("an edit card's body has the tool background across both diff columns", () => {
	const recording = { fg: (_color: string, text: string) => text, bg: (color: string, text: string) => `<${color}>${text}</>`, bold: (text: string) => text } as unknown as Theme;
	const owner: ToolRenderers = { renderResult: () => new Text("↳ diff +1 -1\nold | new", 0, 0) };
	const result = createCompactRenderers("edit", owner, "unicode").renderResult!(
		{ content: [{ type: "text", text: "ok" }], details: undefined },
		{ expanded: false, isPartial: false },
		recording,
		context() as never,
	);

	assert.deepEqual(result.render(14), [`  <toolSuccessBg>old | new   </>`]);
});

test("a write card says Added for a new file and counts its lines", () => {
	const owner: ToolRenderers = { renderResult: () => new Text("↳ created\n1 a\n2 b", 0, 0) };

	assert.equal(renderRow("write", { path: "new.ts", content: "a\nb\n" }, "ok", {}, undefined, owner)[0], "• Added new.ts (+2 -0)");
});

const codemodeDetails = {
	calls: [
		{ id: "c/1", name: "bash", args: "{\"command\":\"ls\"}", status: "ok", durationMs: 25 },
		{ id: "c/2", name: "models.classify", args: "scorer/judge", status: "ok", durationMs: 1300, cost: 0.0021, tokens: 3400 },
	],
};

test("a codemode card totals its calls, cost, tokens, and time and lists every call", () => {
	const output = "Script completed\nWall time 1.2 seconds\nOutput:\n";

	assert.deepEqual(renderRow("codemode", { code: "await tools.bash({})" }, output, { durationMs: 1200 }, codemodeDetails).slice(0, 3), [
		"• codemode · 2 calls ✓ · $0.0021 · 3.4k tok · 1.2s",
		"  ✓ bash {\"command\":\"ls\"} 25ms",
		"  ✓ models.classify scorer/judge 1.3s $0.0021",
	]);
});

test("a running edit or write names its action", () => {
	assert.equal(renderRow("edit", { path: "a.ts" }, "", { isPartial: true })[0], "• Editing a.ts");
	assert.equal(renderRow("write", { path: "a.ts" }, "", { isPartial: true })[0], "• Writing a.ts");
});

test("a failed call turns the bullet red", () => {
	const recording = { fg: (color: string, text: string) => `<${color}>${text}</>`, bold: (text: string) => text } as unknown as Theme;
	const call = createCompactRenderers("read", undefined, "unicode").renderCall!({ path: "a.ts" }, recording, context({ isError: true }) as never);

	assert.match(call.render(200)[0], /^<error>•<\/>/);
});

test("ascii rows never exceed the terminal width", () => {
	const renderers = createCompactRenderers("bash", undefined, "ascii");
	const ctx = context({ args: { command: "ls" } });
	const result = renderers.renderResult!({ content: [{ type: "text", text: `${"x".repeat(60)}\n1\n2\n3\n4` }], details: undefined }, { expanded: false, isPartial: false }, theme, ctx as never);

	for (const line of result.render(12)) assert.ok(stripTerminalSequences(line).length <= 12, line);
});

test("output escape sequences and control bytes do not reach the terminal", () => {
	const lines = renderRow("bash", { command: "x" }, "\u001b[31mred\u001b[0m\u0007 done");

	assert.equal(lines[1], "  └ red done");
});

test("an edit card counts Pi diff rows with padded line numbers", () => {
	const owner: ToolRenderers = { renderResult: () => new Text("body", 0, 0) };
	const diff = "+ 9 added\n+10 added\n- 9 removed\n  8 context";

	assert.equal(renderRow("edit", { path: "a.ts" }, "ok", {}, { diff }, owner)[0], "• Edited a.ts (+2 -1)");
});

test("an overwrite reads its counts from the diff row after the action row", () => {
	const owner: ToolRenderers = { renderResult: () => new Text("↳ overwritten\n↳ diff +3 -2\nbody", 0, 0) };

	assert.equal(renderRow("write", { path: "a.ts", content: "x" }, "ok", {}, undefined, owner)[0], "• Edited a.ts (+3 -2)");
});

test("a write without a known previous state says Wrote", () => {
	assert.equal(renderRow("write", { path: "a.ts", content: "x" }, "Successfully wrote 1 bytes")[0], "• Wrote a.ts");
});

test("a codemode card without token counts omits the token segment", () => {
	const calls = [{ id: "c/1", name: "models.classify", args: "s/j", status: "ok", durationMs: 5, cost: 0.002 }];

	assert.equal(renderRow("codemode", { code: "x" }, "", {}, { calls })[0], "• codemode · 1 call ✓ · $0.0020");
});

test("an expanded card shows every output line", () => {
	const output = Array.from({ length: 6 }, (_, index) => `line ${index + 1}`).join("\n");

	assert.deepEqual(renderRow("bash", { command: "x" }, output, { expanded: true }).slice(1), [
		"  └ line 1", "    line 2", "    line 3", "    line 4", "    line 5", "    line 6",
	]);
});

test("an expanded codemode card keeps the tool background", () => {
	const recording = { fg: (_color: string, text: string) => text, bg: (color: string, text: string) => `<${color}>${text}</>`, bold: (text: string) => text } as unknown as Theme;
	const renderers = createCompactRenderers("codemode", ownRenderer, "unicode");
	const call = renderers.renderCall!({ code: "x" }, recording, context({ expanded: true }) as never);

	assert.deepEqual(call.render(14), ["<toolSuccessBg>owner call    </>"]);
});

test("an expanded codemode card is codemode's own rendering", () => {
	const lines = renderRow("codemode", { code: "x" }, "out", { expanded: true }, codemodeDetails, ownRenderer);

	assert.deepEqual(lines, ["owner call", "owner result"]);
});

test("the profile resolver applies compact cards only while compact style is enabled", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-visual-profile-test-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = directory;
	delete process.env.PI_CODING_AGENT_DIR;
	t.after(() => {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	});
	const configDirectory = join(directory, ".pi", "agent", "visual-profile");
	mkdirSync(configDirectory, { recursive: true });
	let resolver: ((toolName: string, next: () => ToolRenderers | undefined) => ToolRenderers | undefined) | undefined;
	const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
	visualProfile({
		on(name: string, handler: (event: unknown, ctx: unknown) => void) { handlers.set(name, handler); },
		registerCommand() {},
		registerToolRenderer(next: typeof resolver) { resolver = next; },
		events: { emit() {} },
	} as unknown as ExtensionAPI);
	const ctx = {
		cwd: directory,
		mode: "print",
		isProjectTrusted: () => false,
		ui: { theme: {} },
	};
	const start = (config: unknown) => {
		writeFileSync(join(configDirectory, "config.json"), JSON.stringify(config));
		handlers.get("session_start")?.({}, ctx);
	};

	start({ enabled: true, toolCardStyle: "boxed" });
	assert.equal(resolver?.("bash", () => ownRenderer), ownRenderer);

	start({ enabled: true, toolCardStyle: "compact", renderers: { read: "owner" } });
	assert.equal(resolver?.("bash", () => ownRenderer)?.renderShell, "self");
	assert.equal(resolver?.("run_experiment", () => ownRenderer), ownRenderer);
	assert.equal(resolver?.("read", () => ownRenderer), ownRenderer);
});

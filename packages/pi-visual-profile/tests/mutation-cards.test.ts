import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { computeEditsDiff, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { mutationRendererProfile, renderEditCard } from "../mutation-cards.ts";

initTheme("dark");

const theme = {
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	fg: (_color: string, text: string) => text,
};

test("edit profile renders the native preview as one semantic card", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-mutation-card-"));
	await writeFile(join(directory, "notes.txt"), "before\ncontext\n");
	let component!: ToolExecutionComponent;
	let resolvePreview!: () => void;
	const previewReady = new Promise<void>((resolve) => { resolvePreview = resolve; });
	component = new ToolExecutionComponent(
		"edit",
		"edit-preview",
		{ path: "notes.txt", edits: [{ oldText: "before", newText: "after" }] },
		{},
		mutationRendererProfile().tools.edit as never,
		{ requestRender() { if (component.render(80).join("\n").includes("+1 -1")) resolvePreview(); } } as TUI,
		directory,
	);
	component.setArgsComplete();
	await previewReady;
	const output = component.render(80).join("\n");
	assert.match(output, /edit notes\.txt/);
	assert.match(output, /\+1 -1/);
	assert.match(output, /- 1 before/);
	assert.match(output, /\+ 1 after/);
});

test("edit profile clears a stale preview when arguments change", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-mutation-card-"));
	await writeFile(join(directory, "notes.txt"), "before\ncontext\n");
	const component = new ToolExecutionComponent(
		"edit",
		"edit-stale-preview",
		{ path: "notes.txt", edits: [{ oldText: "before", newText: "after" }] },
		{},
		mutationRendererProfile().tools.edit as never,
		{ requestRender() {} } as TUI,
		directory,
	);
	component.setArgsComplete();
	await new Promise((resolve) => setTimeout(resolve, 10));
	component.updateArgs({ path: "notes.txt", edits: [{ oldText: "context", newText: "other" }] });

	assert.doesNotMatch(component.render(80).join("\n"), /before/);
});

test("settled edit details are not replaced by a late preview", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-mutation-card-"));
	await writeFile(join(directory, "notes.txt"), "before\n");
	const component = new ToolExecutionComponent(
		"edit",
		"edit-settled",
		{ path: "notes.txt", edits: [{ oldText: "before", newText: "preview" }] },
		{},
		mutationRendererProfile().tools.edit as never,
		{ requestRender() {} } as TUI,
		directory,
	);
	component.setArgsComplete();
	component.render(80);
	component.updateResult({
		content: [{ type: "text", text: "" }],
		details: { diff: "-1 before\n+1 settled" },
		isError: false,
	});
	await computeEditsDiff("notes.txt", [{ oldText: "before", newText: "preview" }], directory);
	await new Promise<void>((resolve) => setImmediate(resolve));

	assert.match(component.render(80).join("\n"), /\+ 1 settled/);
	assert.doesNotMatch(component.render(80).join("\n"), /\+ 1 preview/);
});

test("edit card presents a preview error with its file identity", () => {
	const output = renderEditCard({ path: "src/notes.ts", error: "exact match not found", expanded: false }, theme, 80).join("\n");

	assert.equal(output, "edit src/notes.ts: exact match not found");
});

test("edit card identifies a replacement with semantic rows and totals", () => {
	const output = renderEditCard({
		path: "src/notes.ts",
		diff: "-12 before\n+12 after\n 13 context",
		expanded: true,
	}, theme, 80).join("\n").replace(/\x1b\[[0-9;]*m/g, "");

	assert.equal(output, [
		"edit src/notes.ts  +1 -1",
		"@@ lines 12-13 @@",
		"- 12 before",
		"+ 12 after",
		"  13 context",
	].join("\n"));
});

test("edit card labels separate hunks", () => {
	const output = renderEditCard({
		path: "src/notes.ts",
		diff: " 2 before\n-3 old\n+3 new\n   ...\n 40 before\n-41 old\n+41 new",
		expanded: true,
	}, theme, 80).join("\n");

	assert.match(output, /@@ lines 2-3 @@/);
	assert.match(output, /@@ lines 40-41 @@/);
});

test("side-by-side edit card pairs removed and added rows", () => {
	const output = renderEditCard({
		path: "src/notes.ts",
		diff: "-12 before\n+12 after\n 13 context",
		expanded: true,
		layout: "side-by-side",
	}, theme, 80).join("\n");

	assert.match(output, /- 12 before.*│.*\+ 12 after/);
	assert.match(output, /13 context.*│.*13 context/);
});

test("side-by-side layout falls back to stacked rows when narrow", () => {
	const output = renderEditCard({
		path: "src/界.ts",
		diff: `-1 ${"界".repeat(20)}\n+1 replacement`,
		expanded: true,
		layout: "side-by-side",
	}, theme, 31).join("\n");

	assert.doesNotMatch(output, /│/);
	assert.match(output, /- 1/);
	assert.match(output, /\+ 1/);
});

test("side-by-side renderer profile applies the selected layout", () => {
	const component = new ToolExecutionComponent(
		"edit",
		"edit-side-by-side",
		{ path: "notes.ts", edits: [{ oldText: "before", newText: "after" }] },
		{},
		mutationRendererProfile("side-by-side").tools.edit as never,
		{ requestRender() {} } as TUI,
		process.cwd(),
	);
	component.setArgsComplete();
	component.updateResult({
		content: [{ type: "text", text: "" }],
		details: { diff: "-1 before\n+1 after" },
		isError: false,
	});

	assert.match(component.render(80).join("\n"), /│/);
});

test("collapsed side-by-side cards keep replacement pairs together", () => {
	const diff = Array.from({ length: 11 }, (_, index) => `-${index + 1} before ${index + 1}\n+${index + 1} after ${index + 1}`).join("\n");
	const output = renderEditCard({
		path: "src/notes.ts",
		diff,
		expanded: false,
		layout: "side-by-side",
	}, theme, 80).join("\n");

	assert.match(output, /- 10 before 10.*│.*\+ 10 after 10/);
	assert.doesNotMatch(output, /- 11 before 11/);
	assert.match(output, /1 more diff rows/);
});

test("collapsed edit card bounds rows and preserves hunk identity", () => {
	const diff = Array.from({ length: 11 }, (_, index) => `+${index + 1} ${"界".repeat(30)}`).join("\n");
	const output = renderEditCard({ path: "src/long.ts", diff, expanded: false }, theme, 80).join("\n");

	assert.match(output, /@@ lines 1-10 @@/);
	assert.match(output, /\+ 1 /);
	assert.doesNotMatch(output, /\+ 11 /);
	assert.match(output, /1 more diff rows/);
	assert.match(output, /to expand/);
});

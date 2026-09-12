import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const packageDirectory = resolve(import.meta.dirname, "..");
const indexPath = resolve(packageDirectory, "docs", "INDEX.md");

function markdownLinks(markdown: string): string[] {
	return Array.from(markdown.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g), (match) => match[1]);
}

test("documentation index links to each current visual-profile guide", () => {
	const index = readFileSync(indexPath, "utf8");
	const links = markdownLinks(index);

	assert.deepEqual(links.sort(), [
		"authoring.md",
		"coexistence.md",
		"configuration.md",
		"installation.md",
		"provenance.md",
		"release.md",
		"rendering.md",
		"troubleshooting.md",
	].sort());
	for (const link of links) assert.doesNotThrow(() => readFileSync(resolve(packageDirectory, "docs", link), "utf8"));
});

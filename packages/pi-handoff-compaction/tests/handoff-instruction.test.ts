import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { requiredHandoffHeadings } from "../handoff-headings.ts";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const instruction = readFileSync(join(packageDir, "handoff-instruction.md"), "utf8");

const expectedHeadings = [
	"Goal and constraints",
	"Initial prompt",
	"Current state",
	"Completed work",
	"Incomplete work",
	"Decisions and reasons",
	"Concrete next steps",
	"Suggested skills",
	"References",
];

test("handoff instruction is fixed Markdown with every required section", () => {
	assert.match(instruction, /^Prepare a handoff document for this Pi session to use after compaction\.\n/m);
	assert.deepEqual(requiredHandoffHeadings, expectedHeadings);
	for (const heading of expectedHeadings) assert.match(instruction, new RegExp(`^## ${heading}$`, "m"));
	assert.match(instruction, /Mark every redacted value with \[REDACTED: reason\]\./);
	assert.doesNotMatch(instruction, /\{[^}\n]+\}/);
});

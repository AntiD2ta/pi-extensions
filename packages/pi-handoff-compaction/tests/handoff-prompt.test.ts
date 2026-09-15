import assert from "node:assert/strict";
import test from "node:test";
import { createHandoffPrompt } from "../handoff-prompt.ts";

test("handoff prompt appends runtime data without altering the fixed instruction", () => {
	const prompt = createHandoffPrompt({
		handoffPath: "/tmp/pi-handoff.md",
		initialPrompt: "Fix the failing test",
		focus: "Preserve API compatibility",
	});

	assert.match(prompt, /^Prepare a handoff document for this Pi session to use after compaction\./);
	assert.match(prompt, /<handoff-runtime>\n\n## Handoff path\n\n\/tmp\/pi-handoff\.md/);
	assert.match(prompt, /## Initial prompt\n\nFix the failing test/);
	assert.match(prompt, /## Optional focus\n\nPreserve API compatibility/);
});

test("handoff prompt omits optional focus when compact has none", () => {
	const prompt = createHandoffPrompt({
		handoffPath: "/tmp/pi-handoff.md",
		initialPrompt: "Fix the failing test",
	});

	assert.doesNotMatch(prompt, /## Optional focus/);
});

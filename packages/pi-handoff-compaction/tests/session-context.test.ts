import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

test("a custom boundary excludes prior turns while retaining session history", () => {
	const session = SessionManager.inMemory(process.cwd());
	session.appendMessage({ role: "user", content: "old conversation sentinel", timestamp: Date.now() });
	session.appendMessage({ role: "user", content: "handoff generation sentinel", timestamp: Date.now() });
	session.appendCustomEntry("handoff-compaction-failure", { reason: "the write tool is inactive" });
	const boundaryId = session.appendCustomEntry("handoff-compaction-boundary", {});
	session.appendCompaction(
		"The prior task state was externalized. Follow the next user message.",
		boundaryId,
		2,
		undefined,
		true,
	);
	session.appendMessage({ role: "user", content: "Read and follow /tmp/pi-handoff.md", timestamp: Date.now() });

	const history = JSON.stringify(session.getEntries());
	const context = JSON.stringify(session.buildSessionContext());
	assert.match(history, /old conversation sentinel/);
	assert.match(history, /handoff generation sentinel/);
	assert.match(history, /the write tool is inactive/);
	assert.doesNotMatch(context, /old conversation sentinel/);
	assert.doesNotMatch(context, /handoff generation sentinel/);
	assert.doesNotMatch(context, /the write tool is inactive/);
	assert.match(context, /The prior task state was externalized/);
	assert.match(context, /Read and follow \/tmp\/pi-handoff\.md/);
});

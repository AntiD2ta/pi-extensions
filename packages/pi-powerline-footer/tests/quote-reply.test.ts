import test from "node:test";
import assert from "node:assert/strict";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { reply } from "../quote-reply.ts";

function contextFor(entries: SessionEntry[], editorText = "draft") {
  let text = editorText;
  const notifications: string[] = [];
  return {
    context: {
      mode: "rpc",
      sessionManager: { getBranch: () => entries },
      ui: {
        getEditorText: () => text,
        setEditorText: (next: string) => { text = next; },
        notify: (message: string) => { notifications.push(message); },
        select: async () => undefined,
      },
    },
    get text() { return text; },
    notifications,
  };
}

test("reply quotes a matching message and preserves the current draft", async () => {
  const harness = contextFor([
    { type: "message", id: "old", timestamp: "2026-08-23T00:00:00.000Z", message: { role: "tool", content: [{ type: "text", text: "ignore" }] } },
    { type: "message", id: "abc123", timestamp: "2026-08-23T00:01:00.000Z", message: { role: "user", content: [{ type: "text", text: "Please inspect this." }] } },
  ]);

  await reply("abc", harness.context);

  assert.equal(harness.text, "Quoted previous user message abc123 for reference only:\n\n> Please inspect this.\n\nMy reply:\ndraft");
  assert.deepEqual(harness.notifications, ["Inserted quote from user message abc123."]);
});

test("reply strips terminal controls from quoted message content and IDs", async () => {
  const harness = contextFor([
    { type: "message", id: "abc\x1b]52;c;payload\x07", timestamp: "2026-08-23T00:01:00.000Z", message: { role: "user", content: [{ type: "text", text: "safe\x1b[31m text\x1b[0m" }] } },
  ]);

  await reply("abc", harness.context);

  assert.doesNotMatch(harness.text, /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/);
  assert.equal(harness.text, "Quoted previous user message abc]52;c;payload for reference only:\n\n> safe[31m text[0m\n\nMy reply:\ndraft");
  assert.deepEqual(harness.notifications, ["Inserted quote from user message abc]52;c;payload."]);
});

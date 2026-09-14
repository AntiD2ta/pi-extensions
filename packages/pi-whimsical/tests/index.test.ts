import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import whimsical from "../index.ts";

test("shows one message for a turn, updates its elapsed time, and resets afterward", async (t) => {
	let turnStart: ((event: never, ctx: { ui: { setWorkingMessage(message?: string): void } }) => Promise<void>) | undefined;
	let turnEnd: ((event: never, ctx: { ui: { setWorkingMessage(message?: string): void } }) => Promise<void>) | undefined;
	const messages: Array<string | undefined> = [];
	const timer = {} as NodeJS.Timeout;
	let update: (() => void) | undefined;
	const clearedTimers: NodeJS.Timeout[] = [];
	const originalDateNow = Date.now;
	const originalMathRandom = Math.random;
	const originalSetInterval = global.setInterval;
	const originalClearInterval = global.clearInterval;
	let now = 0;

	t.after(() => {
		Date.now = originalDateNow;
		Math.random = originalMathRandom;
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
	});

	Date.now = () => now;
	Math.random = () => 0;
	global.setInterval = ((callback: () => void) => {
		update = callback;
		return timer;
	}) as unknown as typeof setInterval;
	global.clearInterval = ((interval?: NodeJS.Timeout) => {
		if (interval !== undefined) clearedTimers.push(interval);
	}) as typeof clearInterval;

	const pi = {
		on(event: "turn_start" | "turn_end", handler: unknown) {
			if (event === "turn_start") turnStart = handler as typeof turnStart;
			else turnEnd = handler as typeof turnEnd;
		},
	};
	const ctx = { ui: { setWorkingMessage: (message?: string) => messages.push(message) } };

	whimsical(pi as ExtensionAPI);
	assert.ok(turnStart);
	assert.ok(turnEnd);

	await turnStart(undefined as never, ctx);
	assert.match(messages[0]!, /^.+ \(now\)$/);
	const baseMessage = messages[0]!.replace(/ \(now\)$/, "");

	now = 1_000;
	update!();
	assert.equal(messages[1], `${baseMessage} (1s)`);

	await turnEnd(undefined as never, ctx);
	assert.equal(messages[2], undefined);
	assert.deepEqual(clearedTimers, [timer]);
});

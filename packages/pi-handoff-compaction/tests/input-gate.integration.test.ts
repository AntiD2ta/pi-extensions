import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ExtensionFactory,
	type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

import handoffCompaction from "../index.ts";
import { requiredHandoffHeadings } from "../handoff-headings.ts";
import powerlineFooter from "../../pi-powerline-footer/index.ts";

const handoffExtension: ExtensionFactory = handoffCompaction;
const powerlineExtension: ExtensionFactory = powerlineFooter;

function handoffDocument() {
	return requiredHandoffHeadings.map((heading) => `## ${heading}\n\ncontent`).join("\n\n");
}

function messageText(content: unknown) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => (
			typeof part === "object" && part !== null && part.type === "text" && typeof part.text === "string"
		))
		.map((part) => part.text)
		.join("\n");
}

for (const [mode, source] of [
	["tui", "interactive"],
	["rpc", "rpc"],
	["json", "rpc"],
	["print", "interactive"],
] as const) {
	test(`handoff compacts successfully and blocks ordinary ${mode} input through Pi's pipeline`, async (t) => {
		const root = mkdtempSync(join(tmpdir(), "pi-handoff-input-"));
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		t.after(() => rmSync(root, { recursive: true, force: true }));

		const faux = fauxProvider({
			provider: `pi-handoff-input-${mode}`,
			models: [{ id: "test-model" }],
		});
		let handoffPath: string | undefined;
		let resolveHandoff: ((message: ReturnType<typeof fauxAssistantMessage>) => void) | undefined;
		let resolveHandoffStarted: (() => void) | undefined;
		let resolveContinuationStarted: (() => void) | undefined;
		const handoffStarted = new Promise<void>((resolve) => { resolveHandoffStarted = resolve; });
		const continuationStarted = new Promise<void>((resolve) => { resolveContinuationStarted = resolve; });
		const pendingHandoff = new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => { resolveHandoff = resolve; });
		faux.setResponses([
			(context) => {
				const path = messageText(context.messages.at(-1)?.content).match(/## Handoff path\n\n(.+)/)?.[1];
				assert.ok(path);
				handoffPath = path;
				resolveHandoffStarted?.();
				return pendingHandoff;
			},
			fauxAssistantMessage("Handoff complete."),
			(context) => {
				assert.ok(messageText(context.messages.at(-1)?.content).startsWith("Read and follow "));
				resolveContinuationStarted?.();
				return fauxAssistantMessage("Continuation complete.");
			},
			() => new Promise(() => {}),
		]);
		const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 } });
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(agentDir, "models-store.json"),
			refreshOnCreate: false,
		});
		const resourceLoader = new DefaultResourceLoader({
			cwd: root,
			agentDir,
			settingsManager,
			extensionFactories: [
				(pi) => { pi.registerProvider(faux.provider); },
				handoffExtension,
			],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await resourceLoader.reload();

		const manager = SessionManager.inMemory(root);
		manager.appendMessage({ role: "user", content: "Earlier request", timestamp: Date.now() });
		manager.appendMessage(fauxAssistantMessage("Earlier response"));
		manager.appendMessage({ role: "user", content: "Latest request", timestamp: Date.now() });
		const { session } = await createAgentSession({
			cwd: root,
			agentDir,
			model: faux.getModel(),
			modelRuntime,
			resourceLoader,
			settingsManager,
			sessionManager: manager,
			tools: ["write"],
		});
		t.after(() => session.dispose());

		const notifications: Array<{ message: string; type?: string }> = [];
		const errors: string[] = [];
		const uiContext = {
			notify(message: string, type?: string) { notifications.push({ message, type }); },
		} as unknown as ExtensionUIContext;
		if (mode === "json" || mode === "print") {
			const originalError = console.error;
			console.error = (message: unknown) => { errors.push(String(message)); };
			t.after(() => { console.error = originalError; });
		}
		await session.bindExtensions({
			mode,
			...(mode === "tui" || mode === "rpc" ? { uiContext } : {}),
		});
		await assert.rejects(session.compact(), /Compaction cancelled/);
		await handoffStarted;

		await session.prompt("Do not enter the handoff turn.", { source });
		assert.equal(
			session.messages.some((message) => message.role === "user" && message.content === "Do not enter the handoff turn."),
			false,
		);
		const message = "Handoff compaction is in progress. Wait for the continuation prompt to finish.";
		if (mode === "tui" || mode === "rpc") assert.deepEqual(notifications, [{ message, type: "error" }]);
		else assert.deepEqual(errors, [message]);

		assert.ok(resolveHandoff);
		assert.ok(handoffPath);
		let resolveCompaction: (() => void) | undefined;
		const compacted = new Promise<void>((resolve) => { resolveCompaction = resolve; });
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "compaction_end" && !event.aborted) resolveCompaction?.();
		});
		resolveHandoff(fauxAssistantMessage(
			fauxToolCall("write", { path: handoffPath, content: handoffDocument() }),
			{ stopReason: "toolUse" },
		));
		await compacted;
		unsubscribe();
		await continuationStarted;
		await session.waitForIdle();
		assert.match(readFileSync(handoffPath, "utf8"), /^## Goal and constraints/m);
		const compactedContext = JSON.stringify(manager.buildSessionContext());
		assert.ok(compactedContext.includes(`Read and follow ${handoffPath}`));
		assert.doesNotMatch(compactedContext, /Earlier request/);
		rmSync(handoffPath, { force: true });

		await assert.rejects(session.compact(), /Compaction cancelled/);
		await session.reload();
		assert.equal(
			manager.getEntries().some((entry) => (
				entry.type === "custom"
				&& entry.customType === "handoff-compaction-failure"
				&& entry.data.reason === "the session was reloaded"
			)),
			true,
		);
	});
}

test("Powerline persists acknowledged handoff input and delivers it FIFO after continuation", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-handoff-powerline-input-"));
	const agentDir = join(root, "agent");
	mkdirSync(agentDir, { recursive: true });
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	t.after(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
	});

	const faux = fauxProvider({
		provider: "pi-handoff-powerline-input",
		models: [{ id: "test-model" }],
	});
	let handoffPath: string | undefined;
	let resolveHandoff: ((message: ReturnType<typeof fauxAssistantMessage>) => void) | undefined;
	let resolveHandoffStarted: (() => void) | undefined;
	let resolveContinuationStarted: (() => void) | undefined;
	let resolveFifoDelivered: (() => void) | undefined;
	const handoffStarted = new Promise<void>((resolve) => { resolveHandoffStarted = resolve; });
	const continuationStarted = new Promise<void>((resolve) => { resolveContinuationStarted = resolve; });
	const fifoDelivered = new Promise<void>((resolve) => { resolveFifoDelivered = resolve; });
	const pendingHandoff = new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => { resolveHandoff = resolve; });
	const deliveredPrompts: string[] = [];
	faux.setResponses([
		(context) => {
			const path = messageText(context.messages.at(-1)?.content).match(/## Handoff path\n\n(.+)/)?.[1];
			assert.ok(path);
			handoffPath = path;
			resolveHandoffStarted?.();
			return pendingHandoff;
		},
		fauxAssistantMessage("Handoff complete."),
		(context) => {
			const prompt = messageText(context.messages.at(-1)?.content);
			assert.ok(prompt.startsWith("Read and follow "));
			deliveredPrompts.push(prompt);
			resolveContinuationStarted?.();
			return fauxAssistantMessage("Continuation complete.");
		},
		(context) => {
			deliveredPrompts.push(messageText(context.messages.at(-1)?.content));
			return fauxAssistantMessage("First queued prompt complete.");
		},
		(context) => {
			deliveredPrompts.push(messageText(context.messages.at(-1)?.content));
			resolveFifoDelivered?.();
			return fauxAssistantMessage("Second queued prompt complete.");
		},
	]);

	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 } });
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(agentDir, "models-store.json"),
		refreshOnCreate: false,
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir,
		settingsManager,
		extensionFactories: [
			(pi) => { pi.registerProvider(faux.provider); },
			handoffExtension,
			powerlineExtension,
		],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();

	const manager = SessionManager.inMemory(root);
	manager.appendMessage({ role: "user", content: "Earlier request", timestamp: Date.now() });
	manager.appendMessage(fauxAssistantMessage("Earlier response"));
	manager.appendMessage({ role: "user", content: "Latest request", timestamp: Date.now() });
	const { session } = await createAgentSession({
		cwd: root,
		agentDir,
		model: faux.getModel(),
		modelRuntime,
		resourceLoader,
		settingsManager,
		sessionManager: manager,
		tools: ["write"],
	});
	t.after(() => session.dispose());
	await session.bindExtensions({ mode: "print" });

	await assert.rejects(session.compact(), /Compaction cancelled/);
	await handoffStarted;
	await session.prompt("FIFO ONE", { source: "rpc" });
	await session.prompt("FIFO TWO", { source: "rpc" });

	const inboxPath = join(agentDir, "powerline-footer", "inbox.jsonl");
	const persistedBeforeRelease = existsSync(inboxPath) ? readFileSync(inboxPath, "utf8") : "";

	assert.ok(resolveHandoff);
	assert.ok(handoffPath);
	resolveHandoff(fauxAssistantMessage(
		fauxToolCall("write", { path: handoffPath, content: handoffDocument() }),
		{ stopReason: "toolUse" },
	));
	await continuationStarted;
	await session.waitForIdle();

	assert.ok(persistedBeforeRelease, "Powerline should persist input after acknowledging the handoff hold");
	const queued = persistedBeforeRelease.trim().split("\n").map((line) => JSON.parse(line) as {
		text: string;
		intent: string;
		status: string;
	});
	assert.deepEqual(queued.map(({ text, intent, status }) => ({ text, intent, status })), [
		{ text: "FIFO ONE", intent: "post-compact", status: "queued" },
		{ text: "FIFO TWO", intent: "post-compact", status: "queued" },
	]);

	await Promise.race([
		fifoDelivered,
		new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for FIFO delivery")), 2_000)),
	]);
	await session.waitForIdle();
	assert.deepEqual(deliveredPrompts.slice(1), ["FIFO ONE", "FIFO TWO"]);
	rmSync(handoffPath, { force: true });
});

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
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

const handoffExtension: ExtensionFactory = handoffCompaction;

for (const [mode, source] of [
	["tui", "interactive"],
	["rpc", "rpc"],
	["json", "rpc"],
	["print", "interactive"],
] as const) {
	test(`handoff blocks ordinary ${mode} input through Pi's pipeline`, async (t) => {
		const root = mkdtempSync(join(tmpdir(), "pi-handoff-input-"));
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		t.after(() => rmSync(root, { recursive: true, force: true }));

		const faux = fauxProvider({
			provider: `pi-handoff-input-${mode}`,
			models: [{ id: "test-model" }],
		});
		faux.setResponses([() => new Promise(() => {})]);
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

		await session.prompt("Do not enter the handoff turn.", { source });
		assert.equal(
			session.messages.some((message) => message.role === "user" && message.content === "Do not enter the handoff turn."),
			false,
		);
		const message = "Handoff compaction is in progress. Wait for the continuation prompt to finish.";
		if (mode === "tui" || mode === "rpc") assert.deepEqual(notifications, [{ message, type: "error" }]);
		else assert.deepEqual(errors, [message]);

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

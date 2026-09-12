import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { fauxAssistantMessage, fauxToolCall, type Context } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSessionEvent,
	type ExtensionFactory,
	type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import extension from "../index.ts";
import { createTestFauxProvider } from "./faux-provider.ts";

const request = {
	context: "The project has two database options.",
	question: "Which database should I use?",
	recommendedAnswer: "PostgreSQL",
	rationale: "It fits the existing deployment platform.",
};

const siblingToolExtension: ExtensionFactory = (pi) => {
	pi.registerTool({
		name: "nonterminating_sibling",
		label: "Non-terminating sibling",
		description: "Return a normal non-terminating tool result for integration testing.",
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: "Sibling completed." }], details: {} };
		},
	});
};

async function createHarness(
	t: TestContext,
	options: { root?: string; sessionFile?: string; withSiblingTool?: boolean } = {},
) {
	const ownsRoot = options.root === undefined;
	const root = options.root ?? mkdtempSync(join(tmpdir(), "pi-agent-status-"));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	const sessionDir = join(root, "sessions");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agentDir, { recursive: true });

	const { extension: fauxExtension, faux } = createTestFauxProvider();
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
	});
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(agentDir, "models-store.json"),
		refreshOnCreate: false,
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: [
			fauxExtension,
			extension,
			...(options.withSiblingTool ? [siblingToolExtension] : []),
		],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model: faux.getModel(),
		modelRuntime,
		resourceLoader,
		settingsManager,
		sessionManager: options.sessionFile
			? SessionManager.open(options.sessionFile)
			: SessionManager.create(cwd, sessionDir),
		tools: options.withSiblingTool
			? ["request_user_input", "nonterminating_sibling"]
			: ["request_user_input"],
	});

	const statuses: Array<[string, string | undefined]> = [];
	const uiContext = {
		setStatus(key: string, value: string | undefined) {
			statuses.push([key, value]);
		},
	} as unknown as ExtensionUIContext;
	const events: AgentSessionEvent[] = [];
	session.subscribe((event) => events.push(event));
	await session.bindExtensions({ mode: "tui", uiContext });

	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		session.dispose();
		if (ownsRoot) rmSync(root, { recursive: true, force: true });
	};
	t.after(dispose);

	return { dispose, events, faux, session, statuses };
}

test("request_user_input ends the run without a follow-up model turn", async (t) => {
	const { events, faux, session, statuses } = await createHarness(t);
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("request_user_input", request), { stopReason: "toolUse" }),
		fauxAssistantMessage("unexpected automatic follow-up"),
	]);

	await session.prompt("Choose the database.");

	assert.equal(faux.state.callCount, 1);
	assert.equal(faux.getPendingResponseCount(), 1);
	assert.equal(events.filter((event) => event.type === "turn_start").length, 1);
	assert.equal(events.filter((event) => event.type === "agent_settled").length, 1);
	assert.equal(session.messages.some((message) =>
		message.role === "assistant" && message.content.some((content) =>
			content.type === "text" && content.text === "unexpected automatic follow-up")), false);
	assert.deepEqual(statuses.at(-1), ["agent-status", "Needs input"]);
});

test("a non-terminating sibling tool result causes a follow-up model turn", async (t) => {
	const { faux, session } = await createHarness(t, { withSiblingTool: true });
	faux.setResponses([
		fauxAssistantMessage([
			fauxToolCall("request_user_input", request),
			fauxToolCall("nonterminating_sibling", {}),
		], { stopReason: "toolUse" }),
		fauxAssistantMessage("Follow-up after the mixed tool batch."),
	]);

	await session.prompt("Choose the database and run the sibling tool.");

	assert.equal(faux.state.callCount, 2);
	assert.equal(session.messages.some((message) =>
		message.role === "assistant" && message.content.some((content) =>
			content.type === "text" && content.text === "Follow-up after the mixed tool batch.")), true);
});

test("the agent receives exclusive-call guidance and resumes from the next free-text prompt", async (t) => {
	const { faux, session, statuses } = await createHarness(t);
	let firstContext: Context | undefined;
	let resumedContext: Context | undefined;
	faux.setResponses([
		(context) => {
			firstContext = context;
			return fauxAssistantMessage(fauxToolCall("request_user_input", request), { stopReason: "toolUse" });
		},
		(context) => {
			resumedContext = context;
			return fauxAssistantMessage("Continuing with PostgreSQL.");
		},
	]);

	await session.prompt("Choose the database.");
	assert.ok(firstContext?.systemPrompt);
	assert.match(firstContext.systemPrompt, /request_user_input only when work cannot continue without user input/);
	assert.match(firstContext.systemPrompt, /sole final tool call/);
	assert.match(firstContext.systemPrompt, /end the current run/);

	await session.prompt("Use PostgreSQL.", { source: "interactive" });

	assert.equal(faux.state.callCount, 2);
	assert.ok(resumedContext);
	assert.equal(resumedContext.messages.some((message) =>
		message.role === "user" && (message.content === "Use PostgreSQL." ||
			(Array.isArray(message.content) && message.content.some((content) =>
				content.type === "text" && content.text === "Use PostgreSQL.")))), true);
	assert.equal(session.messages.some((message) =>
		message.role === "assistant" && message.content.some((content) =>
			content.type === "text" && content.text === "Continuing with PostgreSQL.")), true);
	const entries = session.sessionManager.getBranch();
	const resolution = entries.find((entry) =>
		entry.type === "custom" && entry.customType === "agent-status-input-resolution");
	assert.ok(resolution);
	const response = entries.find((entry) =>
		entry.type === "message" && entry.message.role === "user" && entry.parentId === resolution.id);
	assert.ok(response);
	assert.deepEqual(statuses.at(-1), ["agent-status", undefined]);
});

test("resuming restores an unanswered request without replaying its tool call", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-agent-status-resume-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const initial = await createHarness(t, { root });
	initial.faux.setResponses([
		fauxAssistantMessage(fauxToolCall("request_user_input", request), { stopReason: "toolUse" }),
	]);
	await initial.session.prompt("Choose the database.");
	const sessionFile = initial.session.sessionFile;
	assert.ok(sessionFile);
	initial.dispose();

	const entryCount = SessionManager.open(sessionFile).getEntries().length;
	const resumed = await createHarness(t, { root, sessionFile });

	assert.equal(resumed.faux.state.callCount, 0);
	assert.equal(resumed.events.some((event) => event.type === "tool_execution_start"), false);
	assert.equal(resumed.session.sessionManager.getEntries().length, entryCount);
	assert.deepEqual(resumed.statuses.at(-1), ["agent-status", "Needs input"]);

	resumed.faux.setResponses([fauxAssistantMessage("Continuing with PostgreSQL.")]);
	await resumed.session.prompt("Use PostgreSQL.", { source: "interactive" });
	const entries = resumed.session.sessionManager.getBranch();
	const resolution = entries.find((entry) =>
		entry.type === "custom" && entry.customType === "agent-status-input-resolution");
	assert.ok(resolution);
	assert.equal(entries.some((entry) =>
		entry.type === "message" && entry.message.role === "user" && entry.parentId === resolution.id), true);
	resumed.dispose();

	const resolvedResume = await createHarness(t, { root, sessionFile });
	assert.equal(resolvedResume.faux.state.callCount, 0);
	assert.equal(resolvedResume.statuses.some(([, status]) => status === "Needs input"), false);
});

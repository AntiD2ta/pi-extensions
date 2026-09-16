import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxThinking,
	fauxToolCall,
	type FauxResponseStep,
} from "@earendil-works/pi-ai";

const scenario = process.env.PI_HANDOFF_TRIAL_SCENARIO ?? "success";
const logPath = process.env.PI_HANDOFF_TRIAL_LOG;
const coordinationChannel = "pi-handoff-compaction:v1";

function record(type: string, data: unknown = {}) {
	if (logPath) appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), type, data })}\n`);
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

function latestUserText(context: { messages: Array<{ role: string; content: unknown }> }) {
	return messageText([...context.messages].reverse().find((message) => message.role === "user")?.content);
}

function handoffPath(prompt: string) {
	const path = prompt.match(/## Handoff path\n\n(.+)/)?.[1]?.trim();
	if (!path) throw new Error("Trial fixture could not find the handoff path");
	return path;
}

function validHandoffDocument() {
	return [
		"## Goal and constraints\n\nComplete the deterministic PI-62 visual trial without network access.",
		"## Initial prompt\n\nRun the PI-62 handoff compaction smoke test.",
		"## Current state\n\nThe faux provider is active and the handoff path was supplied by the extension.",
		"## Completed work\n\nThe handoff document was written by the built-in write tool.",
		"## Incomplete work\n\nThe continuation turn and queued prompts still need to run.",
		"## Decisions and reasons\n\nUse deterministic sentinels so ordering is visible.",
		"## Concrete next steps\n\nRead this document, finish continuation, then process queued prompts FIFO.",
		"## Suggested skills\n\nNo skills are needed for this test-only trial.",
		"## References\n\nPlane PI-62 and packages/pi-handoff-compaction/README.md.",
	].join("\n\n");
}

function writeResponse(malformed: boolean, delayed: boolean): FauxResponseStep {
	return async (context) => {
		const prompt = latestUserText(context);
		const path = handoffPath(prompt);
		record("provider:handoff", { scenario, path, malformed, delayed });
		if (delayed) await new Promise((resolve) => setTimeout(resolve, 8_000));
		const content = malformed
			? "## Goal and constraints\n\nMALFORMED-HANDOFF-SENTINEL"
			: validHandoffDocument();
		return fauxAssistantMessage([
			fauxText("HANDOFF-WRITE-STARTED: preparing the deterministic handoff document. "),
			fauxToolCall("write", { path, content }),
		], { stopReason: "toolUse" });
	};
}

function continuationRead(): FauxResponseStep {
	return (context) => {
		const prompt = latestUserText(context);
		const path = prompt.replace(/^Read and follow\s+/, "").trim();
		if (!path || path === prompt) throw new Error("Trial fixture expected the continuation prompt");
		record("provider:continuation", { prompt, path });
		return fauxAssistantMessage([
			fauxText("CONTINUATION-STARTED: reading the verified handoff document. "),
			fauxToolCall("read", { path }),
		], { stopReason: "toolUse" });
	};
}

function handoffResponses(): FauxResponseStep[] {
	const initial = scenario === "threshold"
		? fauxAssistantMessage([
			fauxThinking("threshold-token ".repeat(2400)),
			fauxText("AUTOMATIC-THRESHOLD-ARMED: this turn crosses the 90 percent handoff threshold."),
		])
		: fauxAssistantMessage(`TRIAL-READY: ${scenario}`);
	if (scenario === "missing-write") return [initial];
	if (scenario === "abort") {
		return [initial, fauxAssistantMessage("SCRIPTED-ABORT", {
			stopReason: "aborted",
			errorMessage: "Request was aborted by the deterministic fixture",
		})];
	}
	if (scenario === "malformed") {
		return [initial, writeResponse(true, false), fauxAssistantMessage("MALFORMED-HANDOFF-WRITTEN")];
	}
	return [
		initial,
		writeResponse(false, scenario === "interrupt" || scenario === "success"),
		fauxAssistantMessage("HANDOFF-WRITE-COMPLETE: waiting for validation and context replacement."),
		continuationRead(),
		fauxAssistantMessage("CONTINUATION-COMPLETE: verified the handoff document."),
		fauxAssistantMessage("FIFO-ONE-DELIVERED"),
		fauxAssistantMessage("FIFO-TWO-DELIVERED"),
	];
}

function nativeResponses(): FauxResponseStep[] {
	return [
		fauxAssistantMessage("NATIVE-TRIAL-READY"),
		fauxAssistantMessage([
			fauxThinking("native-compaction-delay ".repeat(120)),
			fauxText("NATIVE-COMPACTION-SUMMARY: preserve the native Pi compaction path."),
		]),
		fauxAssistantMessage("NATIVE-QUEUE-DELIVERED"),
	];
}

export default function fauxHandoffTrial(pi: ExtensionAPI) {
	let ui: { getEditorComponent?: () => unknown } | undefined;
	pi.on("session_start", (_event, ctx) => {
		ui = ctx.ui as { getEditorComponent?: () => unknown };
	});
	pi.events?.on(coordinationChannel, (data) => {
		if (typeof data !== "object" || data === null || !("kind" in data)
			|| (data.kind !== "hold" && data.kind !== "acknowledged" && data.kind !== "release" && data.kind !== "failure")) return;
		record(`coordination:${data.kind}`, {
			...data,
			customEditorFactoryRegistered: typeof ui?.getEditorComponent?.() === "function",
		});
	});

	const faux = fauxProvider({
		provider: "pi-handoff-trial",
		models: [{
			id: `scripted-${scenario}`,
			name: `PI-62 scripted ${scenario}`,
			reasoning: false,
			contextWindow: scenario === "threshold" ? 10_000 : 200_000,
			maxTokens: 20_000,
		}],
		tokensPerSecond: 350,
		tokenSize: { min: 8, max: 8 },
	});
	faux.setResponses(scenario === "native" ? nativeResponses() : handoffResponses());
	pi.registerProvider(faux.provider);

	const registerEventLogger = pi.on as unknown as (
		eventName: string,
		handler: (event: Record<string, unknown>) => void,
	) => void;
	for (const eventName of [
		"session_start", "session_before_compact", "session_compact", "session_compact_failed",
		"before_agent_start", "agent_start", "tool_call", "tool_result", "agent_end", "agent_settled",
	] as const) {
		registerEventLogger(eventName, (event) => {
			const value = event as Record<string, unknown>;
			record(eventName, {
				reason: value.reason,
				aborted: value.aborted,
				prompt: typeof value.prompt === "string" ? value.prompt : undefined,
				toolName: value.toolName,
				input: value.toolName === "write" || value.toolName === "read" ? value.input : undefined,
				isError: value.isError,
			});
		});
	}
	record("fixture:loaded", { scenario, model: `scripted-${scenario}` });
}

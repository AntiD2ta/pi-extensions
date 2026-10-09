import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

/**
 * Trial of compact cards: run from the pi-extensions checkout with `-t +codemode` and a disposable HOME.
 * `write` and `edit` touch only `$HOME/scratch`. The web tools are offline stand-ins, so load it without pi-web-access.
 */
export default function (pi: ExtensionAPI) {
	const faux = fauxProvider({
		provider: "compact-card-trial",
		models: [{ id: "scripted", name: "Compact card trial" }],
		tokensPerSecond: 200,
	});
	const scratch = join(homedir(), "scratch", "notes.ts");
	const step = (name: string, args: Parameters<typeof fauxToolCall>[1]) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
	faux.setResponses([
		step("bash", { command: "git log --oneline -15" }),
		step("bash", { command: "sh -c 'for i in $(seq 1 12); do echo line $i; done; exit 3'" }),
		step("bash", { command: "cd packages\nls\npwd" }),
		step("read", { path: "packages/pi-visual-profile/README.md" }),
		step("grep", { pattern: "registerToolRenderer", path: "packages/pi-visual-profile" }),
		step("ls", { path: "packages" }),
		step("write", { path: scratch, content: "export const notes = [\n\t\"first\",\n\t\"second\",\n];\n" }),
		step("edit", { path: scratch, edits: [{ oldText: "\t\"second\",\n", newText: "\t\"second, edited\",\n\t\"third\",\n" }] }),
		step("web_search", { query: "pi coding agent earendil" }),
		step("fetch_content", { url: "https://example.com" }),
		step("get_search_content", { responseId: "trial-results", queryIndex: 0 }),
		step("mcp__trial__list_items", { query: "bug", limit: 5 }),
		step("codemode", {
			code: [
				"const listing = await tools.bash({ command: 'ls packages' });",
				"const readme = await tools.read({ path: 'README.md', limit: 5 });",
				"const [judge] = await models.getAvailableOfType('classifier', 'compact-card-scorer');",
				"const questions = { approved: { type: 'bool', instructions: 'Approve?', criteria: { true: 'yes', false: 'no' } } };",
				"const verdict = await models.classify(judge, { state: { text: readme }, questions });",
				"return `${listing}\\napproved: ${verdict.answers.approved.probability}`;",
			].join("\n"),
		}),
		step("bash", { command: "sleep 4 && echo finished" }),
		fauxAssistantMessage("The scripted tool calls are complete. Press ctrl+o to compare expanded cards."),
	]);
	pi.registerProvider(faux.provider);
	// Offline stand-ins named like pi-web-access's tools; fetch_content fails to show a failed row.
	const webTool = (name: string, run: () => string) => pi.registerTool({
		name,
		label: name,
		description: `Trial stand-in for ${name}.`,
		parameters: Type.Object({}, { additionalProperties: true }),
		async execute() {
			return { content: [{ type: "text", text: run() }], details: {} };
		},
	});
	const results = Array.from({ length: 8 }, (_, index) => `${index + 1}. https://pi.dev/docs/page-${index + 1}`).join("\n");
	webTool("web_search", () => `${results}\nFull results are stored as responseId "trial-results".`);
	webTool("fetch_content", () => { throw new Error("Could not fetch https://example.com: trial stand-in"); });
	webTool("get_search_content", () => results);
	// Shaped like a built-in MCP tool: its own renderers, which compact replaces, and Pi's real names in details.
	pi.registerTool({
		name: "mcp__trial__list_items",
		label: "trial/list-items",
		description: "Trial stand-in for a built-in MCP tool.",
		parameters: Type.Object({}, { additionalProperties: true }),
		async execute() {
			const text = Array.from({ length: 6 }, (_, index) => `TRI-${index + 1} trial item`).join("\n");
			return { content: [{ type: "text", text }], details: { server: "trial", tool: "list-items" } };
		},
		renderCall: () => new Text("owner call", 0, 0),
		renderResult: () => new Text("owner result", 0, 0),
	});
	// A classifier with fixed usage, so the codemode card shows cost and tokens.
	pi.registerProvider("compact-card-scorer", {
		baseUrl: "https://classifier.invalid/v1",
		apiKey: "trial",
		models: [{
			type: "classifier",
			id: "judge",
			name: "Trial judge",
			api: "compact-card-classifier",
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100000,
		}],
		classifiers: {
			"compact-card-classifier": {
				classify: async (model) => ({
					api: model.api,
					provider: model.provider,
					model: model.id,
					answers: { approved: { type: "bool", probability: 0.9 } },
					usage: {
						input: 1500,
						output: 200,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 1700,
						cost: { input: 0.002, output: 0.0004, cacheRead: 0, cacheWrite: 0, total: 0.0024 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				}),
			},
		},
	});
}

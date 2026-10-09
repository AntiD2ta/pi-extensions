import { keyText, type AgentToolResult, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import type { GlyphMode, RendererChoice } from "./config.ts";

export type ToolRenderers = Pick<ToolDefinition, "renderShell" | "renderCall" | "renderResult">;
type RenderCall = NonNullable<ToolDefinition["renderCall"]>;
type RenderResult = NonNullable<ToolDefinition["renderResult"]>;
type RenderContext = Parameters<RenderCall>[2] & { durationMs?: number; outputPad?: number };
type CardTheme = Pick<Theme, "fg" | "bold">;
type Args = Record<string, unknown>;

interface NestedCall {
	name: string;
	args: string;
	status: "running" | "ok" | "error" | "cancelled";
	durationMs?: number;
	error?: string;
	cost?: number;
	tokens?: number;
}

/** Shared between the call and result renderers of one row. The result renderer runs after the call renderer, and the header reads it at render time. */
interface CardState {
	compactExitCode?: number;
	compactCalls?: NestedCall[];
	compactMutation?: { created: boolean; added?: number; removed?: number };
}

const COMPACT_BY_DEFAULT = new Set([
	"bash",
	"powershell",
	"read",
	"grep",
	"find",
	"ls",
	"edit",
	"write",
	"codemode",
	"web_search",
	"fetch_content",
	"get_search_content",
]);
const TAIL_LINES = 3;
const CALL_ARGS_CHARS = 80;
const SCRIPT_HEADER = /^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/;
/** pi-tool-display's summary row; the compact header carries the same facts. */
const MUTATION_SUMMARY = /^\s*↳ (?:diff \+(\d+) -(\d+)|(created|overwritten)\b)/;
const SHELL_STATUS = /\n*(?:Command exited with code (\d+)|Command timed out after \d+ seconds|Command aborted)\s*$/;

/** Tools named in COMPACT_BY_DEFAULT and tools without their own renderer default to compact. */
export function rendererChoice(toolName: string, owner: ToolRenderers | undefined, choices: Record<string, RendererChoice>): RendererChoice {
	const ownRenderer = Boolean(owner?.renderCall || owner?.renderResult);
	return choices[toolName] ?? (COMPACT_BY_DEFAULT.has(toolName) || !ownRenderer ? "compact" : "owner");
}

export function compactByDefault(): string[] {
	return [...COMPACT_BY_DEFAULT];
}

function lines(render: (width: number) => string[]): Component {
	return { render, invalidate() {} };
}

function padded(component: Component, pad: number): Component {
	return lines((width) => component.render(Math.max(1, width - pad)).map((line) => `${" ".repeat(pad)}${line}`));
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function shortPath(path: unknown): string {
	const value = str(path) ?? ".";
	const home = homedir();
	return value === home || value.startsWith(`${home}/`) ? `~${value.slice(home.length)}` : value;
}

function formatDuration(ms: number | undefined): string | undefined {
	if (ms === undefined) return undefined;
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
	return `$${cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`;
}

function formatTokens(tokens: number): string {
	return tokens < 1000 ? `${tokens} tok` : `${(tokens / 1000).toFixed(1)}k tok`;
}

function callIcon(call: NestedCall, theme: CardTheme): string {
	if (call.status === "running") return theme.fg("warning", "…");
	if (call.status === "ok") return theme.fg("success", "✓");
	if (call.status === "error") return theme.fg("error", "✗");
	return theme.fg("muted", "⊘");
}

/** Same row as Pi's native codemode renderer. */
function formatCall(call: NestedCall, theme: CardTheme): string {
	const args = call.args.length > CALL_ARGS_CHARS ? `${call.args.slice(0, CALL_ARGS_CHARS - 3)}...` : call.args;
	const duration = formatDuration(call.durationMs);
	let line = `${callIcon(call, theme)} ${theme.fg("toolTitle", call.name)}`;
	if (args) line += ` ${theme.fg("muted", args)}`;
	if (duration) line += ` ${theme.fg("dim", duration)}`;
	if (call.cost) line += ` ${theme.fg("dim", formatCost(call.cost))}`;
	return line;
}

function textOutput(toolName: string, result: AgentToolResult<unknown>): string {
	let content = result.content;
	const first = content[0];
	if (toolName === "codemode" && first?.type === "text" && SCRIPT_HEADER.test(first.text)) content = content.slice(1);
	const text = content.map((block) => block.type === "text" ? block.text : `[image: ${block.mimeType}]`).join("\n");
	return text.replace(/\r/g, "").replace(/\t/g, "   ").trimEnd();
}

type Color = Parameters<CardTheme["fg"]>[0];

/** Verb colors tell kinds of tools apart; the other colors highlight header targets. */
const PALETTE = {
	shell: "accent",
	file: "mdHeading",
	search: "syntaxFunction",
	web: "syntaxType",
	edit: "bashMode",
	codemode: "syntaxOperator",
	other: "toolTitle",
	command: "text",
	path: "mdLinkUrl",
	pattern: "mdCode",
	query: "syntaxString",
	url: "mdLinkUrl",
	count: "syntaxNumber",
	cost: "warning",
	tokens: "syntaxType",
} satisfies Record<string, Color>;

/** Bold makes highlighted header targets stand out from the output below them. */
function strong(theme: CardTheme, color: Color, text: string): string {
	return theme.fg(color, theme.bold(text));
}

interface Header {
	verb: string;
	/** Each kind of tool has its own verb color, so rows are easy to tell apart. */
	verbColor: Color;
	/** Styled target text. */
	target: string;
	/** Extra lines of a multi-line target, shown when expanded. */
	more: string[];
	/** Styled details after the target. */
	meta: string[];
}

function shellHeader(args: Args, context: RenderContext, state: CardState, theme: CardTheme): Header {
	const [first = "", ...more] = (str(args.command) ?? "").split("\n");
	const failed = context.isError || (state.compactExitCode ?? 0) !== 0;
	const verb = !context.executionStarted || context.isPartial
		? "Running"
		: failed
			? state.compactExitCode === undefined ? "Failed" : `Failed (exit ${state.compactExitCode})`
			: "Ran";
	const duration = formatDuration(context.durationMs);
	return {
		verb,
		verbColor: PALETTE.shell,
		target: strong(theme, PALETTE.command, first),
		more: more.map((line) => strong(theme, PALETTE.command, line)),
		meta: duration ? [theme.fg("dim", duration)] : [],
	};
}

function countLabel(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function toolHeader(toolName: string, args: Args, context: RenderContext, state: CardState, theme: CardTheme): Header {
	const header = (verb: string, verbColor: Color, target: string): Header => ({ verb, verbColor, target, more: [], meta: [] });
	const path = (value: unknown) => strong(theme, PALETTE.path, shortPath(value));
	const quoted = (value: string) => strong(theme, PALETTE.query, `"${value}"`);
	const url = (value: string) => strong(theme, PALETTE.url, value);
	switch (toolName) {
		case "bash":
		case "powershell":
			return shellHeader(args, context, state, theme);
		case "edit":
		case "write":
			return mutationHeader(toolName, args, context, state, theme, path(args.path));
		case "read":
			return header("Read", PALETTE.file, path(args.path));
		case "grep":
		case "find":
			return header("Search", PALETTE.search, `${strong(theme, PALETTE.pattern, str(args.pattern) ?? "")} ${theme.fg("muted", "in")} ${path(args.path)}`);
		case "ls":
			return header("List", PALETTE.file, path(args.path));
		case "web_search": {
			const queries = Array.isArray(args.queries) ? args.queries : [];
			return header("Searched web", PALETTE.web, queries.length > 1 ? strong(theme, PALETTE.query, `${queries.length} queries`) : quoted(str(queries[0]) ?? str(args.query) ?? ""));
		}
		case "fetch_content": {
			const urls = Array.isArray(args.urls) ? args.urls : [];
			return header("Fetched", PALETTE.web, urls.length > 1 ? strong(theme, PALETTE.url, countLabel(urls.length, "URL")) : url(str(urls[0]) ?? str(args.url) ?? ""));
		}
		case "get_search_content": {
			const detail = str(args.url) ? ` ${url(str(args.url) ?? "")}` : str(args.query) ? ` ${quoted(str(args.query) ?? "")}` : "";
			return header("Loaded", PALETTE.web, `${theme.fg("muted", "search result")} ${strong(theme, PALETTE.count, str(args.responseId) ?? "")}${detail}`);
		}
		default: {
			const target = Object.values(args).find((value) => typeof value === "string") as string | undefined;
			return header(toolName, PALETTE.other, theme.fg("muted", (target ?? JSON.stringify(args) ?? "").replace(/\s+/g, " ")));
		}
	}
}

function mutationHeader(toolName: string, args: Args, context: RenderContext, state: CardState, theme: CardTheme, path: string): Header {
	const running = !context.executionStarted || context.isPartial;
	const mutation = state.compactMutation;
	const name = toolName === "edit" ? "Edit" : "Write";
	const verb = running
		? `${name.slice(0, -1)}ing`
		: context.isError
			? `${name} failed`
			: toolName === "write" && mutation?.created ? "Added" : "Edited";
	const added = mutation?.added ?? (toolName === "write" && mutation?.created ? (str(args.content) ?? "").replace(/\n$/, "").split("\n").length : undefined);
	const counts = added === undefined || running || context.isError
		? ""
		: ` ${theme.fg("dim", "(")}${theme.fg("toolDiffAdded", `+${added}`)} ${theme.fg("toolDiffRemoved", `-${mutation?.removed ?? 0}`)}${theme.fg("dim", ")")}`;
	return { verb, verbColor: PALETTE.edit, target: `${path}${counts}`, more: [], meta: [] };
}

/** Counts from pi-tool-display's summary row, or from Pi's edit diff when another renderer drew it. */
function readMutation(rendered: string[], details: unknown): CardState["compactMutation"] {
	for (const line of rendered) {
		const match = MUTATION_SUMMARY.exec(stripTerminalSequences(line));
		if (match?.[1]) return { created: false, added: Number(match[1]), removed: Number(match[2]) };
		if (match?.[3]) return { created: match[3] === "created" };
	}
	const diff = (details as { diff?: unknown } | undefined)?.diff;
	if (typeof diff !== "string") return undefined;
	const rows = diff.split("\n");
	return { created: false, added: rows.filter((row) => /^\+\d/.test(row)).length, removed: rows.filter((row) => /^-\d/.test(row)).length };
}

function codemodeHeader(context: RenderContext, state: CardState, theme: CardTheme): Header {
	const calls = state.compactCalls ?? [];
	const running = !context.executionStarted || context.isPartial;
	const failed = context.isError || calls.some((call) => call.status === "error");
	const status = running ? theme.fg("warning", "…") : failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
	const cost = calls.reduce((sum, call) => sum + (call.cost ?? 0), 0);
	const tokens = calls.reduce((sum, call) => sum + (call.tokens ?? 0), 0);
	const duration = formatDuration(context.durationMs);
	return {
		verb: "codemode",
		verbColor: PALETTE.codemode,
		target: "",
		more: [],
		meta: [
			`${strong(theme, PALETTE.count, countLabel(calls.length, "call"))} ${status}`,
			...(cost > 0 ? [strong(theme, PALETTE.cost, formatCost(cost))] : []),
			...(tokens > 0 ? [strong(theme, PALETTE.tokens, formatTokens(tokens))] : []),
			...(duration ? [theme.fg("dim", duration)] : []),
		],
	};
}

function bulletColor(context: RenderContext, state: CardState): "warning" | "error" | "success" {
	if (!context.executionStarted || context.isPartial) return "warning";
	const failedCall = state.compactCalls?.some((call) => call.status === "error");
	return context.isError || failedCall || (state.compactExitCode ?? 0) !== 0 ? "error" : "success";
}

/** Codex-style transcript rows: one header line, the tail of the output, and a count of hidden lines. */
export function createCompactRenderers(toolName: string, owner: ToolRenderers | undefined, glyphMode: GlyphMode): ToolRenderers {
	const bullet = glyphMode === "ascii" ? "*" : "•";
	const elbow = glyphMode === "ascii" ? "`-" : "└";
	const isCodemode = toolName === "codemode";

	const renderCall: RenderCall = (args, theme, renderContext) => {
		const context = renderContext as RenderContext;
		const pad = context.outputPad ?? 1;
		if (isCodemode && context.expanded && owner?.renderCall) {
			return padded(owner.renderCall(args, theme, { ...context, lastComponent: undefined }), pad);
		}
		const state = context.state as CardState;
		return lines((width) => {
			const header = isCodemode ? codemodeHeader(context, state, theme) : toolHeader(toolName, (args ?? {}) as Args, context, state, theme);
			const hidden = !context.expanded && header.more.length > 0 ? [theme.fg("muted", `+${countLabel(header.more.length, "line")}`)] : [];
			const meta = [...hidden, ...header.meta];
			const target = header.target ? ` ${header.target}` : "";
			const first = `${theme.fg(bulletColor(context, state), bullet)} ${theme.fg(bulletColor(context, state) === "error" ? "error" : header.verbColor, theme.bold(header.verb))}${target}${meta.length > 0 ? ` ${theme.fg("dim", "·")} ${meta.join(` ${theme.fg("dim", "·")} `)}` : ""}`;
			const continuation = context.expanded ? header.more.map((line) => `  ${line}`) : [];
			const indent = " ".repeat(pad);
			return [first, ...continuation].map((line) => truncateToWidth(`${indent}${line}`, width));
		});
	};

	const renderResult: RenderResult = (result, options, theme, renderContext) => {
		const context = renderContext as RenderContext;
		const pad = context.outputPad ?? 1;
		if (isCodemode && options.expanded && owner?.renderResult) {
			return padded(owner.renderResult(result, options, theme, { ...context, lastComponent: undefined }), pad);
		}
		const state = context.state as CardState;
		if ((toolName === "edit" || toolName === "write") && owner?.renderResult) {
			// The owner's diff body, with its own colors, on the tool background Pi's shell would paint.
			const body = owner.renderResult(result, options, theme, { ...context, lastComponent: undefined });
			state.compactMutation = readMutation(body.render(200), result.details);
			const background = (text: string) => theme.bg(context.isError ? "toolErrorBg" : "toolSuccessBg", text);
			return lines((width) => {
				const bodyWidth = Math.max(1, width - pad - 2);
				return body.render(bodyWidth)
					.filter((line) => !MUTATION_SUMMARY.test(stripTerminalSequences(line)))
					.map((line) => `${" ".repeat(pad + 2)}${background(line + " ".repeat(Math.max(0, bodyWidth - visibleWidth(line))))}`);
			});
		}
		let output = textOutput(toolName, result);
		if (toolName === "bash" || toolName === "powershell") {
			const status = SHELL_STATUS.exec(output);
			if (status) {
				output = output.slice(0, status.index).trimEnd();
				state.compactExitCode = status[1] === undefined ? undefined : Number(status[1]);
			}
		}
		const calls = isCodemode ? ((result.details as { calls?: NestedCall[] } | undefined)?.calls ?? []) : [];
		if (isCodemode) state.compactCalls = calls;
		const outputLines = output ? output.split("\n") : [];
		// Blank lines carry nothing in a three-line preview.
		const tail = outputLines.filter((line) => line.trim() !== "").slice(-TAIL_LINES);
		const color = context.isError ? "error" : "toolOutput";
		const expandKey = keyText("app.tools.expand");

		return lines((width) => {
			const indent = " ".repeat(pad);
			const bodyWidth = Math.max(1, width - pad - 4);
			const rows = calls.map((call) => truncateToWidth(`${indent}  ${formatCall(call, theme)}`, width));
			const shown = options.expanded
				? outputLines.flatMap((line) => wrapTextWithAnsi(theme.fg(color, line), bodyWidth))
				: tail.map((line) => truncateToWidth(theme.fg(color, line), bodyWidth));
			const hidden = options.expanded ? 0 : outputLines.length - tail.length;
			const body = shown.map((line, index) => `${indent}  ${index === 0 ? `${theme.fg("dim", elbow)} ` : "  "}${line}`);
			if (hidden > 0) body.push(`${indent}    ${theme.fg("muted", `+ ${countLabel(hidden, "line")} (${expandKey})`)}`);
			return [...rows, ...body];
		});
	};

	return { renderShell: "self", renderCall, renderResult };
}

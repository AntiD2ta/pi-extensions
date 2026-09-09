import { getCapabilities, hyperlink, stripTerminalSequences, Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ToolCardStyle } from "./config.ts";

type ToolCardTheme = {
	fg(color: "accent" | "dim" | "error" | "success" | "toolOutput" | "toolTitle" | "warning", text: string): string;
	bold(text: string): string;
};

type ToolCardContext = {
	args: unknown;
	cwd: string;
	executionStarted: boolean;
	expanded: boolean;
	isError: boolean;
	isPartial: boolean;
	lastComponent: Component | undefined;
	state: Record<string, unknown>;
};

type ToolCardRenderer = {
	renderShell?: "default" | "self";
	renderCall(args: unknown, theme: ToolCardTheme, context: ToolCardContext): Component;
};

export interface ToolRendererProfile {
	tools: Record<string, ToolCardRenderer>;
}

type ToolArguments = Record<string, unknown>;

function stringArgument(args: ToolArguments, name: string): string | undefined {
	const value = args[name];
	return typeof value === "string" ? value : undefined;
}

function numberArgument(args: ToolArguments, name: string): number | undefined {
	const value = args[name];
	return typeof value === "number" ? value : undefined;
}

function booleanArgument(args: ToolArguments, name: string): boolean | undefined {
	const value = args[name];
	return typeof value === "boolean" ? value : undefined;
}

function asArguments(value: unknown): ToolArguments {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as ToolArguments : {};
}

function safeText(value: string): string {
	return stripTerminalSequences(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function resolvePath(path: string, cwd: string): string {
	const safePath = safeText(path);
	const expandedPath = safePath === "~" ? homedir() : safePath.startsWith("~/") ? `${homedir()}${safePath.slice(1)}` : safePath;
	return resolve(cwd, expandedPath);
}

function shortenPath(path: string): string {
	const home = homedir();
	return path === home ? "~" : path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

function displayPath(path: string, theme: ToolCardTheme, cwd: string): string {
	const safePath = safeText(path);
	const styled = theme.fg("accent", shortenPath(safePath));
	return getCapabilities().hyperlinks ? hyperlink(styled, pathToFileURL(resolvePath(safePath, cwd)).href) : styled;
}

function getPiDocsLabel(path: string): string | undefined {
	const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
	const packageRoot = dirname(dirname(entry));
	const relativePath = relative(packageRoot, resolve(path));
	if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return undefined;
	const label = relativePath.split(sep).join("/");
	return label === "README.md" || label.startsWith("docs/") || label.startsWith("examples/") ? label : undefined;
}

function formatReadArgument(args: ToolArguments, theme: ToolCardTheme, context: ToolCardContext): string {
	const path = stringArgument(args, "file_path") ?? stringArgument(args, "path") ?? "[invalid path]";
	const offset = numberArgument(args, "offset");
	const limit = numberArgument(args, "limit");
	const range = offset === undefined && limit === undefined
		? ""
		: theme.fg("warning", `:${offset ?? 1}${limit === undefined ? "" : `-${(offset ?? 1) + limit - 1}`}`);
	if (!context.expanded) {
		const expandHint = theme.fg("dim", " (Ctrl+O to expand)");
		if (basename(path) === "SKILL.md") return `${theme.fg("toolTitle", "skill")} ${theme.fg("accent", basename(dirname(resolvePath(path, context.cwd))))}${range}${expandHint}`;
		const docsLabel = getPiDocsLabel(resolvePath(path, context.cwd));
		if (docsLabel) return `${theme.fg("toolTitle", "read docs")} ${theme.fg("accent", docsLabel)}${range}${expandHint}`;
		if (["AGENTS.md", "AGENTS.MD", "AGENTS.override.md", "CLAUDE.md", "CLAUDE.MD"].includes(basename(path))) {
			return `${theme.fg("toolTitle", "read resource")} ${displayPath(path, theme, context.cwd)}${range}${expandHint}`;
		}
	}
	return `${displayPath(path, theme, context.cwd)}${range}`;
}

function formatGrepArgument(args: ToolArguments, theme: ToolCardTheme, context: ToolCardContext): string {
	const pattern = safeText(stringArgument(args, "pattern") ?? "[invalid pattern]");
	const path = stringArgument(args, "path") ?? ".";
	const glob = stringArgument(args, "glob");
	const filters = [
		glob === undefined ? undefined : safeText(glob),
		booleanArgument(args, "ignoreCase") ? "ignore case" : undefined,
		booleanArgument(args, "literal") ? "literal" : undefined,
		numberArgument(args, "context") === undefined ? undefined : `context ${numberArgument(args, "context")}`,
		numberArgument(args, "limit") === undefined ? undefined : `limit ${numberArgument(args, "limit")}`,
	].filter((value): value is string => value !== undefined);
	return `${theme.fg("accent", `/${pattern}/`)} ${theme.fg("toolOutput", "in")} ${displayPath(path, theme, context.cwd)}${filters.length ? theme.fg("dim", ` (${filters.join(", ")})`) : ""}`;
}

function formatFindArgument(args: ToolArguments, theme: ToolCardTheme, context: ToolCardContext): string {
	const pattern = safeText(stringArgument(args, "pattern") ?? "[invalid pattern]");
	const path = stringArgument(args, "path") ?? ".";
	const limit = numberArgument(args, "limit");
	return `${theme.fg("accent", pattern)} ${theme.fg("toolOutput", "in")} ${displayPath(path, theme, context.cwd)}${limit === undefined ? "" : theme.fg("dim", ` (limit ${limit})`)}`;
}

function formatListArgument(args: ToolArguments, theme: ToolCardTheme, context: ToolCardContext): string {
	const path = stringArgument(args, "path") ?? ".";
	const limit = numberArgument(args, "limit");
	return `${displayPath(path, theme, context.cwd)}${limit === undefined ? "" : theme.fg("dim", ` (limit ${limit})`)}`;
}

function formatShellArgument(args: ToolArguments, theme: ToolCardTheme, context: ToolCardContext): string {
	if (context.executionStarted && context.state.startedAt === undefined) context.state.startedAt = Date.now();
	const command = safeText(stringArgument(args, "command") ?? "[invalid command]");
	const timeout = numberArgument(args, "timeout");
	return `${theme.fg("accent", command)}${timeout === undefined ? "" : theme.fg("dim", ` (timeout ${timeout}s)`)}`;
}

function state(context: ToolCardContext): "pending" | "success" | "error" {
	if (context.isError) return "error";
	return context.isPartial ? "pending" : "success";
}

function stateLabel(value: ReturnType<typeof state>): string {
	return value === "pending" ? "running" : value;
}

class ToolCardHeader extends Text {
	private title = "";
	private argument = "";
	private stateText = "";
	private usesNativeText = false;

	constructor() {
		super("", 0, 0);
	}

	override setText(text: string): void {
		this.usesNativeText = true;
		super.setText(text);
	}

	update(tool: string, argument: string, theme: ToolCardTheme, context: ToolCardContext): void {
		const currentState = state(context);
		this.usesNativeText = false;
		this.title = theme.fg("toolTitle", theme.bold(tool));
		this.argument = argument;
		this.stateText = theme.fg(currentState === "error" ? "error" : currentState === "success" ? "success" : "warning", `[${stateLabel(currentState)}]`);
	}

	override render(width: number): string[] {
		if (this.usesNativeText) return super.render(width);
		const prefix = `${this.title} `;
		const suffix = ` ${this.stateText}`;
		const available = Math.max(0, width - visibleWidth(prefix) - visibleWidth(suffix));
		return [truncateToWidth(`${prefix}${truncateToWidth(this.argument, available)}${suffix}`, width)];
	}
}

function cardHeader(tool: string, argument: string, theme: ToolCardTheme, context: ToolCardContext): Component {
	const component = context.lastComponent instanceof ToolCardHeader ? context.lastComponent : new ToolCardHeader();
	component.update(tool, argument, theme, context);
	return component;
}

function renderer(
	tool: string,
	format: (args: ToolArguments, theme: ToolCardTheme, context: ToolCardContext) => string,
	style: ToolCardStyle,
): ToolCardRenderer {
	return {
		...(style === "minimal" ? { renderShell: "self" as const } : {}),
		renderCall(_args, theme, context) {
			return cardHeader(tool, format(asArguments(context.args), theme, context), theme, context);
		},
	};
}

export function createToolRendererProfile(style: ToolCardStyle = "boxed"): ToolRendererProfile {
	return {
		tools: {
			read: renderer("read", formatReadArgument, style),
			grep: renderer("grep", formatGrepArgument, style),
			find: renderer("find", formatFindArgument, style),
			ls: renderer("ls", formatListArgument, style),
			bash: renderer("bash", formatShellArgument, style),
			powershell: renderer("powershell", formatShellArgument, style),
		},
	};
}

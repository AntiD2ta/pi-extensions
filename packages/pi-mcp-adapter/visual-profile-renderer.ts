import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text, type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface VisualProfilePresentation {
	borderStyle: "rounded" | "sharp" | "none";
	glyphMode: "unicode" | "nerd-font" | "ascii";
	padding: 0 | 1 | 2 | 3;
}

export interface VisualProfileMcpRenderContext {
	title?: string;
	inputPreview?: string;
}

type McpDetails = Record<string, unknown> & { error?: unknown };
type RenderTheme = {
	fg: (name: string, text: string) => string;
	bg?: (name: string, text: string) => string;
	bold?: (text: string) => string;
};

function identity(details: McpDetails | undefined): string {
	const server = typeof details?.server === "string" ? details.server : typeof details?.hintServer === "string" ? details.hintServer : undefined;
	const operation = typeof details?.tool === "string" ? details.tool : typeof details?.requestedTool === "string" ? details.requestedTool : undefined;
	if (server && operation) return `${server}/${operation}`;
	if (server && typeof details?.resourceUri === "string") return `${server} resource ${details.resourceUri}`;
	return server ?? "MCP";
}

function contentText(result: AgentToolResult<McpDetails>): string {
	return result.content.map((block) => block.type === "text" ? block.text : `[image: ${block.mimeType}]`).join("\n") || "(no output)";
}

function styled(theme: RenderTheme, name: string, text: string): string {
	return theme.bg ? theme.bg(name, text) : text;
}

function padded(line: string, width: number): string {
	const truncated = truncateToWidth(line, width);
	return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

class VisualProfileMcpResult implements Component {
	constructor(
		private readonly result: AgentToolResult<McpDetails>,
		private readonly options: ToolRenderResultOptions,
		private readonly theme: RenderTheme,
		private readonly presentation: VisualProfilePresentation,
		private readonly context: VisualProfileMcpRenderContext | undefined,
	) {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, Math.floor(width));
		const failed = this.options.isPartial === false && Boolean(this.result.details.error);
		const status = this.options.isPartial ? "Running" : failed ? "Failed" : this.result.content.length === 0 ? "Empty result" : "Succeeded";
		const resultIdentity = identity(this.result.details);
		const title = this.context?.title === "mcpScript"
			? this.context.title
			: resultIdentity === "MCP" && this.context?.title
				? this.context.title
				: `MCP ${resultIdentity}`;
		if (safeWidth < 5 || this.presentation.borderStyle === "none") {
			return [truncateToWidth(`${title}: ${status}`, safeWidth)];
		}

		const border = this.presentation.borderStyle === "rounded"
			? { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│", leftTee: "├", rightTee: "┤" }
			: { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|", leftTee: "+", rightTee: "+" };
		const innerWidth = safeWidth - 2;
		const padding = Math.min(this.presentation.padding, Math.max(0, Math.floor((innerWidth - 1) / 2)));
		const bodyWidth = Math.max(1, innerWidth - padding * 2);
		const marker = this.presentation.glyphMode === "ascii" ? ">" : "›";
		const statusText = `${marker} ${status}`;
		const titleAndStatus = `${title} ${statusText}`;
		const headerLines = visibleWidth(titleAndStatus) <= bodyWidth
			? [this.theme.fg("toolTitle", this.theme.bold?.(titleAndStatus) ?? titleAndStatus)]
			: [
				this.theme.fg("toolTitle", this.theme.bold?.(truncateToWidth(title, bodyWidth)) ?? truncateToWidth(title, bodyWidth)),
				this.theme.fg(failed ? "error" : this.options.isPartial ? "warning" : "success", statusText),
			];
		const inputPreview = this.context?.inputPreview;
		const summary = inputPreview ? `args  ${inputPreview.replace(/\s+/g, " ").trim()}` : undefined;
		const text = new Text(contentText(this.result), 0, 0);
		const resultLines = text.render(bodyWidth);
		const collapsed = !this.options.expanded && resultLines.length > 2;
		const preview = this.options.expanded ? resultLines : resultLines.slice(0, 2);
		const bodyLines = [
			...(summary ? [this.theme.fg("muted", summary)] : []),
			...preview.map((line) => this.theme.fg(failed ? "error" : "toolOutput", line)),
			...(collapsed ? [this.theme.fg("muted", "… Ctrl+O to expand")] : []),
		];
		const background = failed ? "toolErrorBg" : this.options.isPartial ? "toolPendingBg" : "toolSuccessBg";
		const renderLine = (line: string) => `${border.vertical}${" ".repeat(padding)}${styled(this.theme, background, padded(line, bodyWidth))}${" ".repeat(padding)}${border.vertical}`;
		return [
			`${border.topLeft}${border.horizontal.repeat(innerWidth)}${border.topRight}`,
			...headerLines.map(renderLine),
			`${border.leftTee}${border.horizontal.repeat(innerWidth)}${border.rightTee}`,
			...bodyLines.map(renderLine),
			`${border.bottomLeft}${border.horizontal.repeat(innerWidth)}${border.bottomRight}`,
		];
	}

	invalidate(): void {}
}

export function renderVisualProfileMcpResult(
	result: AgentToolResult<McpDetails>,
	options: ToolRenderResultOptions,
	theme: RenderTheme,
	presentation: VisualProfilePresentation,
	context?: VisualProfileMcpRenderContext,
): Component {
	return new VisualProfileMcpResult(result, options, theme, presentation, context);
}

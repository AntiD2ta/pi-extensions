import {
	Container,
	Text,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	type Component,
} from "@earendil-works/pi-tui";
import type { ToolCardStyle } from "./config.ts";

export type ToolCardTheme = {
	bg(color: "toolPendingBg" | "toolSuccessBg" | "toolErrorBg", text: string): string;
	fg(color: "border" | "error" | "success" | "toolTitle" | "warning", text: string): string;
};

export type ToolRendererFrameState = "pending" | "success" | "error";

export interface ToolRendererFrameContext {
	call: Component;
	result: Component | undefined;
	state: ToolRendererFrameState;
	expandKeyText: string;
}

export interface ToolRendererProfile {
	tools: Record<string, { renderShell?: string }>;
	frame(context: ToolRendererFrameContext): Component;
}

export interface ToolCardMouseEvent {
	type: string;
	button: string;
	x: number;
	y: number;
	screenX: number;
	screenY: number;
	width: number;
	height: number;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
}

export interface ToolCardMouseEventResult {
	handled?: boolean;
	capture?: boolean;
	focus?: boolean;
	render?: boolean;
}

type MouseCapableComponent = Component & {
	handleMouse?: (event: ToolCardMouseEvent) => ToolCardMouseEventResult | undefined;
};

function handleMouse(component: Component, event: ToolCardMouseEvent): ToolCardMouseEventResult | undefined {
	if (!("handleMouse" in component)) return undefined;
	return (component as MouseCapableComponent).handleMouse?.(event);
}

function statePresentation(state: ToolRendererFrameState): {
	label: string;
	minimalLabel: string;
	background: "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";
	color: "warning" | "success" | "error";
} {
	if (state === "pending") return { label: "Running", minimalLabel: "running", background: "toolPendingBg", color: "warning" };
	if (state === "success") return { label: "Succeeded", minimalLabel: "success", background: "toolSuccessBg", color: "success" };
	return { label: "Failed", minimalLabel: "error", background: "toolErrorBg", color: "error" };
}

function padded(line: string, width: number): string {
	const truncated = truncateToWidth(line, width);
	return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function isNativeImageLine(line: string): boolean {
	return line.includes("\u001b_G") || line.includes("\u001b]1337;File=");
}

class BoxedFrame implements Component {
	private readonly context: ToolRendererFrameContext;
	private readonly theme: ToolCardTheme;
	private mouseLayout: {
		width: number;
		bodyWidth: number;
		headerHeight: number;
		callHeight: number;
		resultHeight: number;
		resultOffset: number;
	} | undefined;

	constructor(context: ToolRendererFrameContext, theme: ToolCardTheme) {
		this.context = context;
		this.theme = theme;
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, Math.floor(width));
		if (safeWidth < 5) return [truncateToWidth(statePresentation(this.context.state).label, safeWidth)];

		const innerWidth = safeWidth - 2;
		const bodyWidth = Math.max(1, innerWidth - 2);
		const renderedCall = this.context.call.render(bodyWidth);
		const presentation = statePresentation(this.context.state);
		const status = this.theme.fg(presentation.color, `› ${presentation.label}`);
		const headerLines = renderedCall.map((line) => truncateToWidth(line.replace(/ +$/, ""), bodyWidth));
		const lastCallLine = headerLines.at(-1);
		if (lastCallLine === undefined) {
			headerLines.push(status);
		} else if (visibleWidth(`${lastCallLine} ${status}`) <= bodyWidth) {
			headerLines[headerLines.length - 1] = `${lastCallLine} ${status}`;
		} else {
			headerLines.push(status);
		}
		const renderedBody = this.context.result?.render(bodyWidth) ?? [];
		const resultOffset = !isNativeImageLine(renderedBody[0] ?? "") && stripTerminalSequences(renderedBody[0] ?? "").trim() === "" ? 1 : 0;
		const bodyLines = renderedBody.slice(resultOffset);
		this.mouseLayout = {
			width: safeWidth,
			bodyWidth,
			headerHeight: headerLines.length,
			callHeight: Math.max(1, renderedCall.length),
			resultHeight: renderedBody.length,
			resultOffset,
		};
		const renderLine = (line: string) => isNativeImageLine(line)
			? line
			: `│ ${this.theme.bg(presentation.background, padded(line, bodyWidth))} │`;
		const horizontal = "─".repeat(innerWidth);

		return [
			this.theme.fg("border", `╭${horizontal}╮`),
			...headerLines.map(renderLine),
			...(bodyLines.length > 0
				? [this.theme.fg("border", `├${horizontal}┤`), ...bodyLines.map(renderLine)]
				: []),
			this.theme.fg("border", `╰${horizontal}╯`),
		];
	}

	handleMouse(event: ToolCardMouseEvent): ToolCardMouseEventResult | undefined {
		const layout = this.mouseLayout?.width === event.width ? this.mouseLayout : undefined;
		if (!layout || event.x < 1 || event.x >= event.width - 1) return undefined;

		if (event.y >= 1 && event.y < 1 + layout.callHeight) {
			return handleMouse(this.context.call, {
				...event,
				x: Math.max(0, event.x - 2),
				y: event.y - 1,
				width: layout.bodyWidth,
				height: layout.callHeight,
			});
		}

		const resultStart = layout.headerHeight + 2;
		if (!this.context.result || event.y < resultStart || event.y >= resultStart + layout.resultHeight - layout.resultOffset) {
			return undefined;
		}
		return handleMouse(this.context.result, {
			...event,
			x: Math.max(0, event.x - 2),
			y: event.y - resultStart + layout.resultOffset,
			width: layout.bodyWidth,
			height: layout.resultHeight,
		});
	}

	invalidate(): void {
		this.mouseLayout = undefined;
		this.context.call.invalidate();
		this.context.result?.invalidate();
	}
}

function minimalFrame(context: ToolRendererFrameContext, theme: ToolCardTheme): Component {
	const frame = new Container();
	const { minimalLabel } = statePresentation(context.state);
	frame.addChild(context.call);
	frame.addChild(new Text(theme.fg("toolTitle", `[${minimalLabel}]`), 0, 0));
	if (context.result) {
		frame.addChild(context.result);
		frame.addChild(new Text(theme.fg("toolTitle", `(${context.expandKeyText} to expand)`), 0, 0));
	}
	return frame;
}

export function createToolRendererProfile(style: ToolCardStyle, theme: ToolCardTheme, mutationProfile: { tools: Record<string, { renderShell?: string }> } = { tools: {} }): ToolRendererProfile {
	return {
		...mutationProfile,
		frame: (context) => style === "boxed" ? new BoxedFrame(context, theme) : minimalFrame(context, theme),
	};
}

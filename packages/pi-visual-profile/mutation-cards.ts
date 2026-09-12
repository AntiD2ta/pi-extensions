// The renderer contract is feature-detected because public Pi versions before PI-25 do not export its types.
// @ts-nocheck
import * as piCodingAgent from "@earendil-works/pi-coding-agent";
import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { DiffLayout } from "./config.ts";

export type CardTheme = Pick<Theme, "bg" | "bold" | "fg">;

type ToolRendererProfile = { tools: Record<string, { renderShell?: string }> };
type EditDiffPreview = { diff: string } | { error: string };
type EditDiffAPI = { computeEditsDiff?: (path: string, edits: Array<{ oldText: string; newText: string }>, cwd: string) => Promise<EditDiffPreview> }; 


export interface EditCardState {
	path: string;
	diff?: string;
	error?: string;
	expanded: boolean;
	layout?: DiffLayout;
}

type DiffRow = {
	content: string;
	line: number | undefined;
	prefix: "+" | "-" | " ";
};

function parseDiffRows(diff: string): DiffRow[] {
	return diff.split("\n").map((line) => {
		const match = line.match(/^([+\- ])\s*(\d*)\s?(.*)$/);
		if (!match) return { content: line, line: undefined, prefix: " " };
		return {
			content: match[3],
			line: match[2] ? Number(match[2]) : undefined,
			prefix: match[1] as DiffRow["prefix"],
		};
	});
}

function renderDiffRow(row: DiffRow | undefined, theme: CardTheme): string {
	if (!row) return "";
	const text = `${row.prefix}${row.line === undefined ? "" : ` ${row.line}`} ${row.content}`;
	return row.prefix === "+"
		? theme.bg("toolSuccessBg", theme.fg("toolDiffAdded", text))
		: row.prefix === "-"
			? theme.bg("toolErrorBg", theme.fg("toolDiffRemoved", text))
			: theme.fg("toolDiffContext", text);
}

type SideBySideRow = [DiffRow | undefined, DiffRow | undefined];

function pairSideBySideRows(rows: DiffRow[]): SideBySideRow[] {
	const output: SideBySideRow[] = [];
	for (let index = 0; index < rows.length;) {
		const row = rows[index];
		if (row.prefix === "-") {
			const removed: DiffRow[] = [];
			while (rows[index]?.prefix === "-") removed.push(rows[index++]);
			const added: DiffRow[] = [];
			while (rows[index]?.prefix === "+") added.push(rows[index++]);
			for (let pair = 0; pair < Math.max(removed.length, added.length); pair++) output.push([removed[pair], added[pair]]);
			continue;
		}
		output.push([row, row]);
		index++;
	}
	return output;
}

function renderSideBySideRows(rows: SideBySideRow[], theme: CardTheme, width: number): string[] {
	const columnWidth = Math.floor((width - 3) / 2);
	const renderColumn = (row: DiffRow | undefined) => {
		const text = truncateToWidth(renderDiffRow(row, theme), columnWidth);
		return text + " ".repeat(Math.max(0, columnWidth - visibleWidth(text)));
	};
	return rows.map(([left, right]) => `${renderColumn(left)} │ ${renderColumn(right)}`);
}

export function renderEditCard(state: EditCardState, theme: CardTheme, width: number): string[] {
	if (state.error) return [truncateToWidth(theme.fg("error", `edit ${state.path}: ${state.error}`), width)];
	if (!state.diff) return [truncateToWidth(`${theme.bold("edit")} ${state.path}`, width)];

	const rows = parseDiffRows(state.diff);
	const additions = rows.filter((row) => row.prefix === "+").length;
	const removals = rows.filter((row) => row.prefix === "-").length;
	const hunks: DiffRow[][] = [[]];
	for (const row of rows) {
		if (row.line === undefined && row.content === "...") {
			hunks.push([]);
			continue;
		}
		hunks[hunks.length - 1].push(row);
	}
	const totals = theme.fg("muted", `  +${additions} -${removals}`);
	const pathWidth = Math.max(0, width - visibleWidth(totals) - visibleWidth("edit "));
	const output = [theme.bold(`edit ${truncateToWidth(state.path, pathWidth)}`) + totals];
	let visibleRows = state.expanded ? rows.length : 10;
	let hiddenRows = 0;
	const sideBySide = state.layout === "side-by-side" && width >= 32;

	for (const hunk of hunks) {
		if (sideBySide) {
			const rows = pairSideBySideRows(hunk);
			const displayed = rows.slice(0, visibleRows);
			hiddenRows += rows.length - displayed.length;
			visibleRows -= displayed.length;
			const lines = displayed.flatMap(([left, right]) => [left, right]).flatMap((row) => row?.line === undefined ? [] : [row.line]);
			if (lines.length > 0) output.push(theme.fg("muted", `@@ lines ${Math.min(...lines)}-${Math.max(...lines)} @@`));
			output.push(...renderSideBySideRows(displayed, theme, width));
			continue;
		}
		const displayed = hunk.slice(0, visibleRows);
		hiddenRows += hunk.length - displayed.length;
		visibleRows -= displayed.length;
		const lines = displayed.flatMap((row) => row.line === undefined ? [] : [row.line]);
		if (lines.length > 0) output.push(theme.fg("muted", `@@ lines ${Math.min(...lines)}-${Math.max(...lines)} @@`));
		output.push(...displayed.map((row) => renderDiffRow(row, theme)));
	}
	if (hiddenRows > 0) {
		output.push(theme.fg("muted", `... (${hiddenRows} more diff rows, ${keyHint("app.tools.expand", "to expand")})`));
	}

	return output.map((line) => truncateToWidth(line, width));
}

type EditArgs = {
	path?: unknown;
	file_path?: unknown;
	edits?: unknown;
	oldText?: unknown;
	newText?: unknown;
};

type MutationRenderState = { card?: EditCardComponent };

class EditCardComponent implements Component {
	private state: EditCardState = { path: "(invalid path)", expanded: false };
	private theme: CardTheme;
	previewKey?: string;
	requestedPreviewKey?: string;
	settledPreviewKey?: string;

	constructor(theme: CardTheme, layout: DiffLayout) {
		this.theme = theme;
		this.state.layout = layout;
	}

	setContext(path: string, expanded: boolean, theme: CardTheme, layout: DiffLayout): void {
		this.state = this.state.path === path ? { ...this.state, expanded, layout } : { path, expanded, layout };
		this.theme = theme;
	}

	setState(state: EditCardState, theme: CardTheme): boolean {
		const next = { ...state, layout: state.layout ?? this.state.layout };
		const changed = this.state.path !== next.path || this.state.diff !== next.diff || this.state.error !== next.error || this.state.expanded !== next.expanded || this.state.layout !== next.layout;
		this.state = next;
		this.theme = theme;
		return changed;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return renderEditCard(this.state, this.theme, width);
	}
}

function getPreviewInput(args: EditArgs): { path: string; edits: Array<{ oldText: string; newText: string }> } | undefined {
	const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;
	if (!path) return undefined;
	if (Array.isArray(args.edits) && args.edits.every((edit) =>
		typeof edit === "object" && edit !== null && typeof edit.oldText === "string" && typeof edit.newText === "string",
	)) {
		return { path, edits: args.edits };
	}
	if (typeof args.oldText === "string" && typeof args.newText === "string") {
		return { path, edits: [{ oldText: args.oldText, newText: args.newText }] };
	}
	return undefined;
}

export function mutationRendererProfile(layout: DiffLayout = "stacked"): ToolRendererProfile {
	return { tools: {
		edit: {
			renderShell: "self",
			renderCall(args, theme, context) {
				const state = context.state as MutationRenderState;
				const card = context.lastComponent instanceof EditCardComponent
					? context.lastComponent
					: state.card ?? new EditCardComponent(theme, layout);
				state.card = card;
				const input = getPreviewInput(args as EditArgs);
				const previewKey = input ? JSON.stringify(input) : undefined;
				const path = input?.path ?? "(invalid path)";
				card.setContext(path, context.expanded, theme, layout);
				if (card.previewKey !== previewKey) {
					card.previewKey = previewKey;
					card.settledPreviewKey = undefined;
					card.setState({ path, expanded: context.expanded }, theme);
				}
				const computeEditsDiff = (piCodingAgent as EditDiffAPI).computeEditsDiff;
				if (context.argsComplete && input && computeEditsDiff && card.requestedPreviewKey !== previewKey && card.settledPreviewKey !== previewKey) {
					card.requestedPreviewKey = previewKey;
					void computeEditsDiff(input.path, input.edits, context.cwd).then((preview) => {
							if (card.previewKey !== previewKey || card.settledPreviewKey === previewKey) return;
							if (card.setState(
								"error" in preview
									? { path: input.path, error: preview.error, expanded: context.expanded }
									: { path: input.path, diff: preview.diff, expanded: context.expanded },
								theme,
							)) context.invalidate();
						});
				}
				return card;
			},
			renderResult(result, _options, theme, context) {
				const card = (context.state as MutationRenderState).card;
				const args = context.args as EditArgs;
				const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : "(invalid path)";
				if (card && context.isError) {
					const error = result.content
						.filter((content) => content.type === "text")
						.map((content) => content.text ?? "")
						.join("\n");
					card.settledPreviewKey = card.previewKey;
					if (card.setState({ path, error, expanded: context.expanded }, theme)) context.invalidate();
				}
				if (card && !context.isError && typeof result.details === "object" && result.details !== null && "diff" in result.details && typeof result.details.diff === "string") {
					card.settledPreviewKey = card.previewKey;
					if (card.setState({ path, diff: result.details.diff, expanded: context.expanded }, theme)) context.invalidate();
				}
				return new Container();
			},
		},
	} };
}

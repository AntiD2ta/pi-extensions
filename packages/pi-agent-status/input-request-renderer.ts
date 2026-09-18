import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { InputRequest } from "./input-state.ts";

const MIN_COLUMN_CONTENT_WIDTH = 34;
const MAX_COLUMN_HEIGHT_RATIO = 2.5;

const border = {
	topLeft: "╭",
	topRight: "╮",
	bottomLeft: "╰",
	bottomRight: "╯",
	horizontal: "─",
	vertical: "│",
	leftTee: "├",
	rightTee: "┤",
};

interface Field {
	label: string;
	value: string;
	tinted: boolean;
	strong?: boolean;
}

interface Line {
	text: string;
	tinted: boolean;
}

function pad(line: string, width: number): string {
	const clipped = truncateToWidth(line, width);
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function wrapValue(value: string, width: number): string[] {
	const lines: string[] = [];
	for (const source of value.split(/\r\n|\r|\n/)) {
		if (source.length === 0) {
			lines.push("");
			continue;
		}
		const bullet = source.match(/^(\s*[-*]\s+)(.+)$/);
		const prefixWidth = bullet ? visibleWidth(bullet[1]) : 0;
		if (!bullet || prefixWidth >= width) {
			lines.push(...wrapTextWithAnsi(source, width));
			continue;
		}
		const wrapped = wrapTextWithAnsi(bullet[2], width - prefixWidth);
		lines.push(...wrapped.map((line, index) => `${index === 0 ? bullet[1] : " ".repeat(prefixWidth)}${line}`));
	}
	return lines.length > 0 ? lines : [""];
}

function renderField(field: Field, width: number, theme: Theme): Line[] {
	return [
		...wrapValue(field.label, width).map((line) => ({ text: theme.fg("muted", line), tinted: field.tinted })),
		...wrapValue(field.value, width).map((line) => ({
			text: theme.fg("text", field.strong ? theme.bold(line) : line),
			tinted: field.tinted,
		})),
	];
}

export function renderInputRequest(request: InputRequest, theme: Theme): Component {
	const fields: Field[] = [
		{ label: "Question", value: request.question, tinted: false, strong: true },
		{ label: "Context", value: request.context, tinted: false },
		{ label: "Recommended answer", value: request.recommendedAnswer, tinted: true },
		{ label: "Rationale", value: request.rationale, tinted: true },
	];

	return {
		render(width: number) {
			const safeWidth = Math.max(1, Math.floor(width));
			if (safeWidth < 5) {
				return [
					...wrapValue("request_user_input", safeWidth)
						.map((line) => theme.bg("toolPendingBg", theme.fg("toolTitle", theme.bold(line)))),
					...wrapValue("Needs input", safeWidth)
						.map((line) => theme.bg("toolPendingBg", theme.fg("warning", line))),
					...fields.flatMap((field) => renderField(field, safeWidth, theme)
						.map((line) => line.tinted ? theme.bg("toolPendingBg", line.text) : line.text)),
				];
			}

			const innerWidth = safeWidth - 2;
			const paint = (line: string, lineWidth: number, tinted: boolean) => {
				const padded = pad(line, lineWidth);
				return tinted ? theme.bg("toolPendingBg", padded) : padded;
			};
			const title = "request_user_input";
			const status = "Needs input";
			const top = `${border.topLeft}${border.horizontal.repeat(innerWidth)}${border.topRight}`;
			const divider = `${border.leftTee}${border.horizontal.repeat(innerWidth)}${border.rightTee}`;
			const bottom = `${border.bottomLeft}${border.horizontal.repeat(innerWidth)}${border.bottomRight}`;
			const contentWidth = innerWidth - 2;
			const frameHeader = (line: string) => `${theme.fg("border", border.vertical)}${paint(` ${line} `, innerWidth, true)}${theme.fg("border", border.vertical)}`;
			const headerLines = visibleWidth(title) + visibleWidth(status) + 3 <= innerWidth
				? [frameHeader(
					theme.fg("toolTitle", theme.bold(title))
					+ " ".repeat(innerWidth - visibleWidth(title) - visibleWidth(status) - 2)
					+ theme.fg("warning", status),
				)]
				: [
					...wrapValue(title, contentWidth).map((line) => frameHeader(theme.fg("toolTitle", theme.bold(line)))),
					...wrapValue(status, contentWidth).map((line) => frameHeader(theme.fg("warning", line))),
				];
			const renderStack = () => {
				const lines: string[] = [];
				for (const [index, field] of fields.entries()) {
					if (index > 0) lines.push(theme.fg("border", divider));
					for (const line of renderField(field, contentWidth, theme)) {
						lines.push(
							theme.fg("border", border.vertical)
							+ paint(` ${line.text} `, innerWidth, line.tinted)
							+ theme.fg("border", border.vertical),
						);
					}
				}
				return [theme.fg("border", top), ...headerLines, theme.fg("border", divider), ...lines, theme.fg("border", bottom)];
			};
			const splitSpace = innerWidth - 1;
			const leftWidth = Math.floor(splitSpace * 0.58);
			const rightWidth = splitSpace - leftWidth;
			if (leftWidth - 2 < MIN_COLUMN_CONTENT_WIDTH || rightWidth - 2 < MIN_COLUMN_CONTENT_WIDTH) return renderStack();
			const renderColumn = (columnFields: Field[], columnWidth: number, includeSeparator: boolean) => {
				const contentWidth = columnWidth - 2;
				const lines: Line[] = [];
				for (const [index, field] of columnFields.entries()) {
					if (index > 0) {
						lines.push(includeSeparator
							? { text: theme.fg("border", border.horizontal.repeat(contentWidth)), tinted: field.tinted }
							: { text: "", tinted: field.tinted });
					}
					lines.push(...renderField(field, contentWidth, theme));
				}
				return lines;
			};
			const left = renderColumn(fields.slice(0, 2), leftWidth, false);
			const right = renderColumn(fields.slice(2), rightWidth, true);
			const shorterColumn = Math.max(1, Math.min(left.length, right.length));
			if (Math.max(left.length, right.length) > shorterColumn * MAX_COLUMN_HEIGHT_RATIO) return renderStack();
			const rowCount = Math.max(left.length, right.length);
			const rows: string[] = [];
			for (let index = 0; index < rowCount; index++) {
				const leftLine = left[index] ?? { text: "", tinted: false };
				const rightLine = right[index] ?? { text: "", tinted: true };
				rows.push(
					theme.fg("border", border.vertical)
					+ paint(` ${leftLine.text} `, leftWidth, leftLine.tinted)
					+ theme.fg("border", border.vertical)
					+ paint(` ${rightLine.text} `, rightWidth, rightLine.tinted)
					+ theme.fg("border", border.vertical),
				);
			}
			return [
				theme.fg("border", top),
				...headerLines,
				theme.fg("border", divider),
				...rows,
				theme.fg("border", bottom),
			];
		},
		invalidate() {},
	};
}

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type GlyphMode = "unicode" | "nerd-font" | "ascii";
export type BorderStyle = "rounded" | "sharp" | "none";
export type SeparatorStyle = "chevron" | "powerline" | "dot" | "none";
export type ThemeMode = "profile" | "inherit";

export interface VisualProfileConfig {
	enabled: boolean;
	themeMode: ThemeMode;
	glyphMode: GlyphMode;
	borderStyle: BorderStyle;
	separatorStyle: SeparatorStyle;
	padding: number;
	footerRows: number;
	usageWindowHours: number;
}

export const DEFAULT_CONFIG: VisualProfileConfig = {
	enabled: false,
	themeMode: "profile",
	glyphMode: "unicode",
	borderStyle: "rounded",
	separatorStyle: "chevron",
	padding: 1,
	footerRows: 2,
	usageWindowHours: 5,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
	return typeof value === "string" && values.includes(value as T);
}

function parseConfigPatch(value: unknown): Partial<VisualProfileConfig> {
	if (!isRecord(value)) return {};

	return {
		...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
		...(isOneOf(value.themeMode, ["profile", "inherit"]) ? { themeMode: value.themeMode } : {}),
		...(isOneOf(value.glyphMode, ["unicode", "nerd-font", "ascii"]) ? { glyphMode: value.glyphMode } : {}),
		...(isOneOf(value.borderStyle, ["rounded", "sharp", "none"]) ? { borderStyle: value.borderStyle } : {}),
		...(isOneOf(value.separatorStyle, ["chevron", "powerline", "dot", "none"])
			? { separatorStyle: value.separatorStyle }
			: {}),
		...(typeof value.padding === "number" && Number.isInteger(value.padding) && value.padding >= 0 && value.padding <= 3
			? { padding: value.padding }
			: {}),
		...(typeof value.footerRows === "number" && Number.isInteger(value.footerRows) && value.footerRows >= 1 && value.footerRows <= 3
			? { footerRows: value.footerRows }
			: {}),
		...(typeof value.usageWindowHours === "number" && Number.isFinite(value.usageWindowHours) && value.usageWindowHours > 0
			? { usageWindowHours: value.usageWindowHours }
			: {}),
	};
}

function readConfigPatch(path: string): Partial<VisualProfileConfig> {
	try {
		return parseConfigPatch(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return {};
	}
}

export function loadConfig(globalPath: string, projectPath?: string): VisualProfileConfig {
	return {
		...DEFAULT_CONFIG,
		...readConfigPatch(globalPath),
		...(projectPath ? readConfigPatch(projectPath) : {}),
	};
}

export function parseConfig(value: unknown): VisualProfileConfig {
	return { ...DEFAULT_CONFIG, ...parseConfigPatch(value) };
}

export function saveConfig(path: string, patch: Partial<VisualProfileConfig>): boolean {
	try {
		const existing = readFileSync(path, "utf8");
		const parsed = JSON.parse(existing);
		if (!isRecord(parsed)) return false;
		const next = { ...parsed, ...patch };
		const temporaryPath = `${path}.tmp`;
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(temporaryPath, JSON.stringify(next, null, 2) + "\n");
		renameSync(temporaryPath, path);
		return true;
	} catch (error) {
		if (!(error instanceof Error) || !error.message.includes("ENOENT")) return false;
		try {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, JSON.stringify(patch, null, 2) + "\n");
			return true;
		} catch {
			return false;
		}
	}
}

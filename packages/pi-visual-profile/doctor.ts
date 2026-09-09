import type { VisualProfileConfig } from "./config.ts";

export interface DoctorReport {
	scope: string;
	config: VisualProfileConfig;
	darkThemeAvailable: boolean;
	lightThemeAvailable: boolean;
	globalPath: string;
	projectPath?: string;
}

export function formatDoctor(report: DoctorReport): string {
	const { config } = report;
	return [
		"Visual profile doctor",
		"",
		"Scope",
		`  ${report.scope}`,
		"",
		"Configuration",
		`  enabled: ${config.enabled ? "yes" : "no"}`,
		`  theme: ${config.themeMode}`,
		`  glyphs: ${config.glyphMode}`,
		`  border: ${config.borderStyle}`,
		`  separator: ${config.separatorStyle}`,
		`  padding: ${config.padding}`,
		`  footer rows: ${config.footerRows}`,
		`  usage window: ${config.usageWindowHours} hours`,
		`  tool cards: ${config.toolCardStyle}`,
		"",
		"Themes",
		`  pi-visual-profile-dark: ${report.darkThemeAvailable ? "available" : "unavailable"}`,
		`  pi-visual-profile-light: ${report.lightThemeAvailable ? "available" : "unavailable"}`,
		"",
		"Compatibility",
		"  footer override: supported",
		"  unsupported surfaces: native Pi rendering",
		"",
		"Configuration files",
		`  global: ${report.globalPath}`,
		...(report.projectPath ? [`  project: ${report.projectPath}`] : []),
	].join("\n");
}

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
		`  padding: ${config.padding}`,
		"",
		"Themes",
		`  pi-visual-profile-dark: ${report.darkThemeAvailable ? "available" : "unavailable"}`,
		`  pi-visual-profile-light: ${report.lightThemeAvailable ? "available" : "unavailable"}`,
		"",
		"Compatibility",
		"  footer: never claimed",
		"  visible surfaces: none yet, enabling only stores configuration",
		"  unsupported surfaces: native Pi rendering",
		"",
		"Configuration files",
		`  global: ${report.globalPath}`,
		...(report.projectPath ? [`  project: ${report.projectPath}`] : []),
	].join("\n");
}

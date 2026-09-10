import type { VisualProfileConfig } from "./config.ts";

export interface McpPresentationResult {
	supported: boolean;
	accepted: boolean;
	owner?: string;
}

export function describeMcpPresentation(active: boolean, result: McpPresentationResult | undefined): string {
	if (!result) return "adapter unavailable";
	if (active && result.accepted) return "profile boxed rendering active";
	if (!active && (result.accepted || result.owner === undefined)) return "adapter native rendering";
	return `owned by ${result.owner ?? "another extension"}`;
}

export interface DoctorReport {
	scope: string;
	config: VisualProfileConfig;
	darkThemeAvailable: boolean;
	lightThemeAvailable: boolean;
	globalPath: string;
	projectPath?: string;
	mcpPresentation: string;
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
		"",
		"Themes",
		`  pi-visual-profile-dark: ${report.darkThemeAvailable ? "available" : "unavailable"}`,
		`  pi-visual-profile-light: ${report.lightThemeAvailable ? "available" : "unavailable"}`,
		"",
		"Compatibility",
		"  footer override: supported",
		`  MCP presentation: ${report.mcpPresentation}`,
		"  unsupported surfaces: native Pi rendering",
		"",
		"Configuration files",
		`  global: ${report.globalPath}`,
		...(report.projectPath ? [`  project: ${report.projectPath}`] : []),
	].join("\n");
}

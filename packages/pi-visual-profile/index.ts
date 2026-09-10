import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { join } from "node:path";
import { DEFAULT_CONFIG, type GlyphMode, type VisualProfileConfig, loadConfig, saveConfig } from "./config.ts";
import { describeMcpPresentation, formatDoctor } from "./doctor.ts";

const PROFILE_THEME_DARK = "pi-visual-profile-dark";
const PROFILE_THEME_LIGHT = "pi-visual-profile-light";
const MCP_PRESENTATION_EVENT = "pi-mcp-adapter:presentation:v1";

interface McpPresentationRequest {
	version: 1;
	owner: string;
	action: "acquire" | "update" | "release" | "query";
	profile?: {
		style: "boxed";
		borderStyle: VisualProfileConfig["borderStyle"];
		glyphMode: GlyphMode;
		padding: VisualProfileConfig["padding"];
	};
	result?: { supported: boolean; accepted: boolean; owner?: string };
}

function configPaths(cwd: string): { global: string; project: string } {
	return {
		global: join(getAgentDir(), "visual-profile", "config.json"),
		project: join(cwd, CONFIG_DIR_NAME, "visual-profile", "config.json"),
	};
}

function effectiveConfig(ctx: ExtensionContext): VisualProfileConfig {
	const paths = configPaths(ctx.cwd);
	return loadConfig(paths.global, ctx.isProjectTrusted() ? paths.project : undefined);
}

function glyph(mode: GlyphMode, unicode: string, nerdFont: string, ascii: string): string {
	if (mode === "ascii") return ascii;
	return mode === "nerd-font" ? nerdFont : unicode;
}

function applyProfile(ctx: ExtensionContext): boolean {
	const config = effectiveConfig(ctx);
	if (!config.enabled || ctx.mode !== "tui") return false;

	ctx.ui.setFooter((tui, theme, footerData) => ({
		invalidate() {},
		dispose: footerData.onBranchChange(() => tui.requestRender()),
		render(width: number): string[] {
			const separator = config.separatorStyle === "none"
				? " "
				: config.separatorStyle === "dot"
					? ` ${glyph(config.glyphMode, "•", "●", ".")} `
					: config.separatorStyle === "powerline"
						? ` ${glyph(config.glyphMode, "▶", "", ">>")} `
						: ` ${glyph(config.glyphMode, "›", "", ">")} `;
			const branch = footerData.getGitBranch() ?? "no branch";
			const themeText = config.themeMode === "inherit" ? "inherit" : "profile";
			const text = ` visual ${themeText}${separator}${config.glyphMode}${separator}${branch} `;
			return [truncateToWidth(theme.bg("toolPendingBg", theme.fg("toolTitle", text)), width)];
		},
	}));
	return true;
}

function save(ctx: ExtensionContext, patch: Partial<VisualProfileConfig>, local: boolean): boolean {
	if (local && !ctx.isProjectTrusted()) {
		ctx.ui.notify("Project configuration requires a trusted project.", "error");
		return false;
	}
	const paths = configPaths(ctx.cwd);
	const saved = saveConfig(local ? paths.project : paths.global, patch);
	if (!saved) ctx.ui.notify("Could not save visual-profile configuration.", "error");
	return saved;
}

function parseLocal(args: string): { local: boolean; values: string[] } {
	const values = args.trim().split(/\s+/).filter(Boolean);
	return { local: values.includes("--local"), values: values.filter((value) => value !== "--local") };
}

function doctor(ctx: ExtensionContext, mcpPresentation: string): string {
	const paths = configPaths(ctx.cwd);
	const themes = new Set(ctx.ui.getAllThemes().map((theme) => theme.name));
	const projectTrusted = ctx.isProjectTrusted();
	return formatDoctor({
		scope: projectTrusted ? "project overrides global" : "global",
		config: effectiveConfig(ctx),
		darkThemeAvailable: themes.has(PROFILE_THEME_DARK),
		lightThemeAvailable: themes.has(PROFILE_THEME_LIGHT),
		globalPath: paths.global,
		projectPath: projectTrusted ? paths.project : undefined,
		mcpPresentation,
	});
}

export default function (pi: ExtensionAPI) {
	let ownsFooter = false;
	let mcpPresentation = "adapter unavailable";

	function syncMcpPresentation(config: VisualProfileConfig, active: boolean): void {
		const request: McpPresentationRequest = {
			version: 1,
			owner: "pi-visual-profile",
			action: active ? "acquire" : "release",
			...(active ? { profile: { style: "boxed", borderStyle: config.borderStyle, glyphMode: config.glyphMode, padding: config.padding } } : {}),
		};
		pi.events.emit(MCP_PRESENTATION_EVENT, request);
		mcpPresentation = describeMcpPresentation(active, request.result);
	}

	pi.on("session_start", (_event, ctx) => {
		ownsFooter = applyProfile(ctx);
		syncMcpPresentation(effectiveConfig(ctx), ownsFooter);
	});

	pi.on("session_shutdown", () => {
		syncMcpPresentation(DEFAULT_CONFIG, false);
	});

	pi.registerCommand("visual-profile", {
		description: "Show or configure the opt-in visual profile.",
		handler: async (args, ctx) => {
			const { local, values } = parseLocal(args);
			const [command, value] = values;
			if (!command || command === "status") {
				ctx.ui.notify(JSON.stringify(effectiveConfig(ctx)), "info");
				return;
			}
			if (command === "doctor") {
				ctx.ui.notify(doctor(ctx, mcpPresentation), "info");
				return;
			}
			if (command === "enable" || command === "disable" || command === "inherit") {
				const patch = command === "enable"
					? { enabled: true }
					: command === "disable"
						? { enabled: false }
						: { themeMode: "inherit" as const };
				if (!save(ctx, patch, local)) return;
				const nextOwnsFooter = applyProfile(ctx);
				if (!nextOwnsFooter && ownsFooter) ctx.ui.setFooter(undefined);
				ownsFooter = nextOwnsFooter;
				syncMcpPresentation(effectiveConfig(ctx), ownsFooter);
				ctx.ui.notify(`Visual profile ${command === "inherit" ? "now inherits the selected Pi theme" : `${command}d`}${local ? " locally" : " globally"}.`, "info");
				return;
			}
			if (command === "glyph" && (value === "unicode" || value === "nerd-font" || value === "ascii")) {
				if (!save(ctx, { glyphMode: value }, local)) return;
				ownsFooter = applyProfile(ctx);
				syncMcpPresentation(effectiveConfig(ctx), ownsFooter);
				ctx.ui.notify(`Glyph mode set to ${value}${local ? " locally" : " globally"}.`, "info");
				return;
			}
			ctx.ui.notify("Usage: /visual-profile [status|enable|disable|inherit|glyph <unicode|nerd-font|ascii>|doctor] [--local]", "error");
		},
	});
}

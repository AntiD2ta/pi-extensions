import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { type GlyphMode, type VisualProfileConfig, loadConfig, saveConfig } from "./config.ts";
import { describeMcpPresentation, formatDoctor } from "./doctor.ts";
import { mutationRendererProfile } from "./mutation-cards.ts";
import { createToolRendererProfile, type ToolRendererProfile } from "./tool-cards.ts";

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

function doctor(ctx: ExtensionContext, mcpPresentation: string, toolRendererProfileSupported: boolean): string {
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
		toolRendererProfileSupported,
	});
}

type ProfileCapableExtensionAPI = ExtensionAPI & {
	activateToolRendererProfile?: (profile: ToolRendererProfile) => () => void;
};

export default function (pi: ExtensionAPI) {
	let mcpPresentation = "adapter unavailable";
	let releaseToolRendererProfile: (() => void) | undefined;
	const profileAPI = pi as ProfileCapableExtensionAPI;

	function syncMcpPresentation(config: VisualProfileConfig): void {
		const active = config.enabled;
		const request: McpPresentationRequest = {
			version: 1,
			owner: "pi-visual-profile",
			action: active ? "acquire" : "release",
			...(active ? { profile: { style: "boxed", borderStyle: config.borderStyle, glyphMode: config.glyphMode, padding: config.padding } } : {}),
		};
		pi.events.emit(MCP_PRESENTATION_EVENT, request);
		mcpPresentation = describeMcpPresentation(active, request.result);
	}

	function syncToolRendererProfile(ctx: ExtensionContext, config: VisualProfileConfig): void {
		releaseToolRendererProfile?.();
		releaseToolRendererProfile = undefined;
		if (config.enabled && ctx.mode === "tui" && profileAPI.activateToolRendererProfile) {
			releaseToolRendererProfile = profileAPI.activateToolRendererProfile(
				createToolRendererProfile(config.toolCardStyle, ctx.ui.theme, mutationRendererProfile(config.diffLayout)),
			);
		}
	}

	function syncPresentation(ctx: ExtensionContext): void {
		const config = effectiveConfig(ctx);
		syncMcpPresentation(config);
		syncToolRendererProfile(ctx, config);
	}

	pi.on("session_start", (_event, ctx) => {
		syncPresentation(ctx);
	});

	pi.on("session_shutdown", () => {
		releaseToolRendererProfile?.();
		releaseToolRendererProfile = undefined;
		const request: McpPresentationRequest = { version: 1, owner: "pi-visual-profile", action: "release" };
		pi.events.emit(MCP_PRESENTATION_EVENT, request);
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
				ctx.ui.notify(doctor(ctx, mcpPresentation, Boolean(profileAPI.activateToolRendererProfile)), "info");
				return;
			}
			if (command === "enable" || command === "disable" || command === "inherit") {
				const patch = command === "enable"
					? { enabled: true }
					: command === "disable"
						? { enabled: false }
						: { themeMode: "inherit" as const };
				if (!save(ctx, patch, local)) return;
				syncPresentation(ctx);
				const unavailable = command === "enable" && !profileAPI.activateToolRendererProfile ? " Tool cards require a newer Pi build." : "";
				ctx.ui.notify(`Visual profile ${command === "inherit" ? "now inherits the selected Pi theme" : `${command}d`}${local ? " locally" : " globally"}.${unavailable}`, unavailable ? "warning" : "info");
				return;
			}
			if (command === "glyph" && (value === "unicode" || value === "nerd-font" || value === "ascii")) {
				if (!save(ctx, { glyphMode: value }, local)) return;
				syncPresentation(ctx);
				ctx.ui.notify(`Glyph mode set to ${value}${local ? " locally" : " globally"}.`, "info");
				return;
			}
			if (command === "cards" && (value === "boxed" || value === "minimal")) {
				if (!save(ctx, { toolCardStyle: value }, local)) return;
				syncPresentation(ctx);
				const unavailable = !profileAPI.activateToolRendererProfile ? " Tool cards require a newer Pi build." : "";
				ctx.ui.notify(`Tool cards set to ${value}${local ? " locally" : " globally"}.${unavailable}`, unavailable ? "warning" : "info");
				return;
			}
			if (command === "diff" && (value === "stacked" || value === "side-by-side")) {
				if (!save(ctx, { diffLayout: value }, local)) return;
				syncPresentation(ctx);
				ctx.ui.notify(`Diff layout set to ${value}${local ? " locally" : " globally"}.`, "info");
				return;
			}
			ctx.ui.notify("Usage: /visual-profile [status|enable|disable|inherit|glyph <unicode|nerd-font|ascii>|cards <boxed|minimal>|diff <stacked|side-by-side>|doctor] [--local]", "error");
		},
	});
}

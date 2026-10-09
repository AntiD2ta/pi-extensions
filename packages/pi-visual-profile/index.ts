import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { createCompactRenderers, rendererChoice, type ToolRenderers } from "./compact-cards.ts";
import { type GlyphMode, type RendererChoice, type VisualProfileConfig, loadConfig, saveConfig } from "./config.ts";
import { describeMcpPresentation, formatDoctor } from "./doctor.ts";
import { mutationRendererProfile } from "./mutation-cards.ts";
import { createProfileSurfaces } from "./surfaces.ts";
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

function doctor(ctx: ExtensionContext, mcpPresentation: string, toolRendererProfileSupported: boolean, toolRendererResolverSupported: boolean): string {
	const paths = configPaths(ctx.cwd);
	const themes = new Set(ctx.ui.getAllThemes().map((theme) => theme.name));
	const projectTrusted = ctx.isProjectTrusted();
	const ui = ctx.ui as typeof ctx.ui & {
		setMarkdownCodeFenceChromeOverride?: unknown;
		setEditorComponentOverride?: unknown;
	};
	const nativeSurfaceAvailable = ctx.mode === "tui";
	return formatDoctor({
		scope: projectTrusted ? "project overrides global" : "global",
		config: effectiveConfig(ctx),
		darkThemeAvailable: themes.has(PROFILE_THEME_DARK),
		lightThemeAvailable: themes.has(PROFILE_THEME_LIGHT),
		nativeFenceChromeAvailable: nativeSurfaceAvailable && typeof ui.setMarkdownCodeFenceChromeOverride === "function",
		nativeEditorPaddingAvailable: nativeSurfaceAvailable && typeof ui.setEditorComponentOverride === "function",
		globalPath: paths.global,
		projectPath: projectTrusted ? paths.project : undefined,
		mcpPresentation,
		toolRendererProfileSupported,
		toolRendererResolverSupported,
	});
}

// Feature-detected: the profile hook is fork-only, and `registerToolRenderer` arrived in Pi 1.1.
type ProfileCapableExtensionAPI = ExtensionAPI & {
	activateToolRendererProfile?: (profile: ToolRendererProfile) => () => void;
	registerToolRenderer?: (resolver: (toolName: string, next: () => ToolRenderers | undefined) => ToolRenderers | undefined) => void;
};

export default function (pi: ExtensionAPI) {
	let mcpPresentation = "adapter unavailable";
	let releaseToolRendererProfile: (() => void) | undefined;
	let surfaceContext: ExtensionContext | undefined;
	const profileAPI = pi as ProfileCapableExtensionAPI;
	const surfaces = createProfileSurfaces();
	let compactConfig: VisualProfileConfig | undefined;

	profileAPI.registerToolRenderer?.((toolName, next) => {
		const owner = next();
		if (!compactConfig || rendererChoice(toolName, owner, compactConfig.renderers) === "owner") return owner;
		return createCompactRenderers(toolName, owner, compactConfig.glyphMode);
	});

	// Compact cards need `registerToolRenderer`; the other styles need the fork's profile hook.
	function cardsSupported(style: VisualProfileConfig["toolCardStyle"]): boolean {
		return Boolean(style === "compact" ? profileAPI.registerToolRenderer : profileAPI.activateToolRendererProfile);
	}

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
		compactConfig = config.enabled && config.toolCardStyle === "compact" ? config : undefined;
		syncMcpPresentation(config);
		syncToolRendererProfile(ctx, config);
		surfaces.apply(ctx, config);
		surfaceContext = ctx;
	}

	pi.on("session_start", (_event, ctx) => {
		syncPresentation(ctx);
	});

	pi.on("session_shutdown", () => {
		compactConfig = undefined;
		releaseToolRendererProfile?.();
		releaseToolRendererProfile = undefined;
		if (surfaceContext) surfaces.release(surfaceContext);
		surfaceContext = undefined;
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
				ctx.ui.notify(doctor(ctx, mcpPresentation, Boolean(profileAPI.activateToolRendererProfile), Boolean(profileAPI.registerToolRenderer)), "info");
				return;
			}
			if (command === "enable" || command === "disable") {
				if (!save(ctx, { enabled: command === "enable" }, local)) return;
				syncPresentation(ctx);
				const unavailable = command === "enable" && !cardsSupported(effectiveConfig(ctx).toolCardStyle) ? " Tool cards require a newer Pi build." : "";
				ctx.ui.notify(`Visual profile ${command}d${local ? " locally" : " globally"}.${unavailable}`, unavailable ? "warning" : "info");
				return;
			}
			if (command === "glyph" && (value === "unicode" || value === "nerd-font" || value === "ascii")) {
				if (!save(ctx, { glyphMode: value }, local)) return;
				syncPresentation(ctx);
				ctx.ui.notify(`Glyph mode set to ${value}${local ? " locally" : " globally"}.`, "info");
				return;
			}
			if (command === "cards" && (value === "boxed" || value === "minimal" || value === "compact")) {
				if (!save(ctx, { toolCardStyle: value }, local)) return;
				syncPresentation(ctx);
				const unavailable = !cardsSupported(value) ? " Tool cards require a newer Pi build." : "";
				ctx.ui.notify(`Tool cards set to ${value}${local ? " locally" : " globally"}.${unavailable}`, unavailable ? "warning" : "info");
				return;
			}
			if (command === "renderer") {
				let tool: string | undefined = value;
				let choice: string | undefined = values[2];
				if (!tool) {
					const config = effectiveConfig(ctx);
					const names = pi.getAllTools().map((entry) => entry.name).sort();
					const picked = await ctx.ui.select("Tool renderer", names.map((name) => `${name} · ${config.renderers[name] ?? "default"}`));
					tool = picked?.split(" · ")[0];
					choice = tool ? await ctx.ui.select(`Renderer for ${tool}`, ["compact", "owner"]) : undefined;
					if (!tool || !choice) return;
				}
				if (tool && (choice === "compact" || choice === "owner")) {
					const paths = configPaths(ctx.cwd);
					// Merge into the file being written, so a local override does not copy global choices.
					const renderers: Record<string, RendererChoice> = { ...loadConfig(local ? paths.project : paths.global).renderers, [tool]: choice };
					if (!save(ctx, { renderers }, local)) return;
					syncPresentation(ctx);
					const inactive = effectiveConfig(ctx).toolCardStyle === "compact" ? "" : " It applies with /visual-profile cards compact.";
					ctx.ui.notify(`Renderer for ${tool} set to ${choice}${local ? " locally" : " globally"}.${inactive}`, "info");
					return;
				}
			}
			if (command === "diff" && (value === "stacked" || value === "side-by-side")) {
				if (!save(ctx, { diffLayout: value }, local)) return;
				syncPresentation(ctx);
				ctx.ui.notify(`Diff layout set to ${value}${local ? " locally" : " globally"}.`, "info");
				return;
			}
			ctx.ui.notify("Usage: /visual-profile [status|enable|disable|glyph <unicode|nerd-font|ascii>|cards <boxed|minimal|compact>|renderer [<tool> compact|owner]|diff <stacked|side-by-side>|doctor] [--local]", "error");
		},
	});
}

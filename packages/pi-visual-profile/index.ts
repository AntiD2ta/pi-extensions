import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { type VisualProfileConfig, loadConfig, saveConfig } from "./config.ts";
import { formatDoctor } from "./doctor.ts";
import { createToolRendererProfile, type ToolRendererProfile } from "./tool-cards.ts";

const PROFILE_THEME_DARK = "pi-visual-profile-dark";
const PROFILE_THEME_LIGHT = "pi-visual-profile-light";

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

function doctor(ctx: ExtensionContext): string {
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
	});
}

type ProfileCapableExtensionAPI = ExtensionAPI & {
	activateToolRendererProfile?: (profile: ToolRendererProfile) => () => void;
};

export default function (pi: ExtensionAPI) {
	let releaseToolRendererProfile: (() => void) | undefined;
	const profileAPI = pi as ProfileCapableExtensionAPI;

	const apply = (ctx: ExtensionContext) => {
		releaseToolRendererProfile?.();
		releaseToolRendererProfile = undefined;
		const config = effectiveConfig(ctx);
		if (config.enabled && ctx.mode === "tui") {
			releaseToolRendererProfile = profileAPI.activateToolRendererProfile?.(
			createToolRendererProfile(config.toolCardStyle),
		);
		}
	};

	pi.on("session_start", (_event, ctx) => {
		apply(ctx);
	});

	pi.on("session_shutdown", () => {
		releaseToolRendererProfile?.();
		releaseToolRendererProfile = undefined;
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
				ctx.ui.notify(doctor(ctx), "info");
				return;
			}
			if (command === "enable" || command === "disable" || command === "inherit") {
				const patch = command === "enable"
					? { enabled: true }
					: command === "disable"
						? { enabled: false }
						: { themeMode: "inherit" as const };
				if (!save(ctx, patch, local)) return;
				apply(ctx);
				ctx.ui.notify(`Visual profile ${command === "inherit" ? "now inherits the selected Pi theme" : `${command}d`}${local ? " locally" : " globally"}.`, "info");
				return;
			}
			if (command === "glyph" && (value === "unicode" || value === "nerd-font" || value === "ascii")) {
				if (!save(ctx, { glyphMode: value }, local)) return;
				apply(ctx);
				ctx.ui.notify(`Glyph mode set to ${value}${local ? " locally" : " globally"}.`, "info");
				return;
			}
			if (command === "cards" && (value === "boxed" || value === "minimal")) {
				if (!save(ctx, { toolCardStyle: value }, local)) return;
				apply(ctx);
				ctx.ui.notify(`Tool cards set to ${value}${local ? " locally" : " globally"}.`, "info");
				return;
			}
			ctx.ui.notify("Usage: /visual-profile [status|enable|disable|inherit|glyph <unicode|nerd-font|ascii>|cards <boxed|minimal>|doctor] [--local]", "error");
		},
	});
}

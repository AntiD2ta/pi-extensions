import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { GlyphMode, VisualProfileConfig } from "./config.ts";

const PROFILE_THEME_DARK = "pi-visual-profile-dark";
const PROFILE_THEME_LIGHT = "pi-visual-profile-light";

type MarkdownCodeFenceChrome = {
	header: (options: { language?: string; path?: string; width: number }) => string[];
	body: (lines: string[]) => string[];
	closing: () => string[];
};
type EditorFactory = (
	tui: ConstructorParameters<typeof CustomEditor>[0],
	theme: ConstructorParameters<typeof CustomEditor>[1],
	keybindings: ConstructorParameters<typeof CustomEditor>[2],
) => CustomEditor;
type ProfileSurfaceUI = {
	setMarkdownCodeFenceChromeOverride?: (owner: object, chrome: MarkdownCodeFenceChrome | undefined) => unknown;
	setEditorComponentOverride?: (owner: object, factory: EditorFactory | undefined) => unknown;
	setThemeOverride?: (owner: object, theme: string | undefined) => unknown;
	getAllThemes?: () => Array<{ name: string }>;
};

function glyph(mode: GlyphMode, unicode: string, nerdFont: string, ascii: string): string {
	if (mode === "ascii") return ascii;
	return mode === "nerd-font" ? nerdFont : unicode;
}

function createCodeFenceChrome(config: VisualProfileConfig): MarkdownCodeFenceChrome {
	const horizontal = glyph(config.glyphMode, "─", "─", "-");
	const borderGlyphs = config.borderStyle === "rounded"
		? [glyph(config.glyphMode, "╭", "", "+"), glyph(config.glyphMode, "╰", "", "+")]
		: config.borderStyle === "sharp"
			? [glyph(config.glyphMode, "┌", "┌", "+"), glyph(config.glyphMode, "└", "└", "+")]
			: ["", ""];
	return {
		header: ({ language, path, width }) => {
			const label = path ?? language;
			return borderGlyphs[0] && label && width >= visibleWidth(label) + 4 ? [`${borderGlyphs[0]}${horizontal} ${label}`] : [];
		},
		body: (lines) => lines,
		closing: () => borderGlyphs[1] ? [`${borderGlyphs[1]}${horizontal}`] : [],
	};
}

export function createProfileSurfaces() {
	const owner = {};
	let ownsCodeFenceChrome = false;
	let ownsEditor = false;
	let ownsTheme = false;

	function apply(ctx: ExtensionContext, config: VisualProfileConfig): void {
		const enabled = config.enabled && ctx.mode === "tui";
		const ui = ctx.ui as typeof ctx.ui & ProfileSurfaceUI;
		const profileTheme = ctx.ui.theme.name?.toLowerCase().includes("light") ? PROFILE_THEME_LIGHT : PROFILE_THEME_DARK;
		const wantsTheme = enabled && config.themeMode === "profile" && typeof ui.getAllThemes === "function" && ui.getAllThemes().some((theme) => theme.name === profileTheme);
		if (typeof ui.setMarkdownCodeFenceChromeOverride === "function" && (enabled || ownsCodeFenceChrome)) {
			ui.setMarkdownCodeFenceChromeOverride(owner, enabled ? createCodeFenceChrome(config) : undefined);
			ownsCodeFenceChrome = enabled;
		}
		const wantsEditor = enabled;
		if (typeof ui.setEditorComponentOverride === "function" && wantsEditor !== ownsEditor) {
			ui.setEditorComponentOverride(owner, wantsEditor ? (tui, theme, keybindings) => {
				class ProfileEditor extends CustomEditor {
					override setPaddingX(): void {
						super.setPaddingX(config.padding);
					}
				}
				return new ProfileEditor(tui, theme, keybindings, { paddingX: config.padding });
			} : undefined);
			ownsEditor = wantsEditor;
		}
		if (typeof ui.setThemeOverride === "function" && (wantsTheme || ownsTheme)) {
			ui.setThemeOverride(owner, wantsTheme ? profileTheme : undefined);
			ownsTheme = wantsTheme;
		}
	}

	function release(ctx: ExtensionContext): void {
		const ui = ctx.ui as typeof ctx.ui & ProfileSurfaceUI;
		if (ownsCodeFenceChrome && typeof ui.setMarkdownCodeFenceChromeOverride === "function") {
			ui.setMarkdownCodeFenceChromeOverride(owner, undefined);
			ownsCodeFenceChrome = false;
		}
		if (ownsEditor && typeof ui.setEditorComponentOverride === "function") {
			ui.setEditorComponentOverride(owner, undefined);
			ownsEditor = false;
		}
		if (ownsTheme && typeof ui.setThemeOverride === "function") {
			ui.setThemeOverride(owner, undefined);
			ownsTheme = false;
		}
	}

	return { apply, release };
}

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type CodeFenceChrome = {
	header(options: { language?: string; path?: string; width: number }): string[];
	body(lines: string[]): string[];
	closing(): string[];
};

type CodeFenceUI = {
	setMarkdownCodeFenceChromeOverride?: (owner: object, chrome: CodeFenceChrome | undefined) => unknown;
};

export default function installProfileAwareExtension(pi: ExtensionAPI): void {
	const owner = {};
	let ownsCodeFenceChrome = false;

	function release(ctx: ExtensionContext): void {
		const ui = ctx.ui as typeof ctx.ui & CodeFenceUI;
		if (!ownsCodeFenceChrome || typeof ui.setMarkdownCodeFenceChromeOverride !== "function") return;
		ui.setMarkdownCodeFenceChromeOverride(owner, undefined);
		ownsCodeFenceChrome = false;
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const ui = ctx.ui as typeof ctx.ui & CodeFenceUI;
		if (typeof ui.setMarkdownCodeFenceChromeOverride !== "function") return;
		ui.setMarkdownCodeFenceChromeOverride(owner, {
			header: ({ language }) => language ? [`[${language}]`] : [],
			body: (lines) => lines,
			closing: () => [],
		});
		ownsCodeFenceChrome = true;
	});

	pi.on("session_shutdown", (_event, ctx) => release(ctx));
}

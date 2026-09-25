import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function imageMarkers(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const ui = ctx.ui as typeof ctx.ui & { setImageMarkersEnabled?: (enabled: boolean) => void };
		if (typeof ui.setImageMarkersEnabled === "function") ui.setImageMarkersEnabled(true);
		else ui.notify("Image markers require the AntiD2ta/pi fork", "warning");
	});
}

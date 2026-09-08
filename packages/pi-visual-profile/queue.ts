import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("visual-profile-queue", {
		description: "Report the independently loadable visual-profile queue shell.",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Visual-profile queue shell is loaded; delivery moves in PI-32.", "info");
		},
	});
}

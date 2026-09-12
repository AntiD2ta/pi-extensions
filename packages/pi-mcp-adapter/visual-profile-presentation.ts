import type { VisualProfilePresentation } from "./visual-profile-renderer.ts";

export const MCP_VISUAL_PROFILE_PRESENTATION_EVENT = "pi-mcp-adapter:presentation:v1" as const;
export const MCP_VISUAL_PROFILE_PRESENTATION_VERSION = 1 as const;

export interface McpVisualProfilePresentationRequest {
	version: typeof MCP_VISUAL_PROFILE_PRESENTATION_VERSION;
	owner: string;
	action: "acquire" | "update" | "release" | "query";
	profile?: VisualProfilePresentation;
	result?: { supported: boolean; accepted: boolean; owner?: string };
}

export function applyVisualProfilePresentation(
	currentOwner: string | undefined,
	request: McpVisualProfilePresentationRequest,
): { owner: string | undefined; profile: VisualProfilePresentation | undefined; result: NonNullable<McpVisualProfilePresentationRequest["result"]> } {
	if (request.version !== MCP_VISUAL_PROFILE_PRESENTATION_VERSION) return { owner: currentOwner, profile: undefined, result: { supported: false, accepted: false, ...(currentOwner ? { owner: currentOwner } : {}) } };
	if (request.action === "query") return { owner: currentOwner, profile: undefined, result: { supported: true, accepted: currentOwner === request.owner, ...(currentOwner ? { owner: currentOwner } : {}) } };
	if (request.action === "release") {
		return currentOwner === request.owner
			? { owner: undefined, profile: undefined, result: { supported: true, accepted: true } }
			: { owner: currentOwner, profile: undefined, result: { supported: true, accepted: false, ...(currentOwner ? { owner: currentOwner } : {}) } };
	}
	if (!request.profile || (currentOwner !== undefined && currentOwner !== request.owner)) return { owner: currentOwner, profile: undefined, result: { supported: true, accepted: false, ...(currentOwner ? { owner: currentOwner } : {}) } };
	return { owner: request.owner, profile: request.profile, result: { supported: true, accepted: true, owner: request.owner } };
}

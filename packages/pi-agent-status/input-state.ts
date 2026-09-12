import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface InputRequest {
	context: string;
	question: string;
	recommendedAnswer: string;
	rationale: string;
	toolCallId: string;
}

interface InputResolution {
	toolCallId: string;
}

function isInputRequest(value: unknown): value is Omit<InputRequest, "toolCallId"> {
	if (!value || typeof value !== "object") return false;
	const details = value as Record<string, unknown>;
	return [details.context, details.question, details.recommendedAnswer, details.rationale]
		.every((field) => typeof field === "string" && field.length > 0);
}

function isInputResolution(value: unknown): value is InputResolution {
	return Boolean(value && typeof value === "object" && typeof (value as Record<string, unknown>).toolCallId === "string");
}

export function createUnresolvedInputState(pi: ExtensionAPI) {
	let request: InputRequest | undefined;
	let onChange: (() => void) | undefined;

	const setRequest = (next: InputRequest | undefined) => {
		request = next;
		onChange?.();
	};

	return {
		isUnresolved: () => request !== undefined,
		onUnresolvedInputChange(next: () => void) {
			onChange = next;
		},
		requestInput(toolCallId: string, params: Omit<InputRequest, "toolCallId">) {
			const next = { ...params, toolCallId };
			setRequest(next);
			return next;
		},
		resolveInput() {
			if (!request) return false;
			pi.appendEntry<InputResolution>("agent-status-input-resolution", { toolCallId: request.toolCallId });
			setRequest(undefined);
			return true;
		},
		restore(ctx: Pick<ExtensionContext, "sessionManager">) {
			setRequest(undefined);
			const branch = ctx.sessionManager.getBranch();
			for (const entry of branch) {
				if (entry.type === "message" && entry.message.role === "toolResult") {
					if (entry.message.toolName === "request_user_input" && isInputRequest(entry.message.details)) {
						setRequest({ ...entry.message.details, toolCallId: entry.message.toolCallId });
					}
					continue;
				}
				if (entry.type !== "custom" || entry.customType !== "agent-status-input-resolution") continue;
				if (!request || !isInputResolution(entry.data) || entry.data.toolCallId !== request.toolCallId) continue;
				const isResolved = branch.some((child) =>
					child.parentId === entry.id && child.type === "message" && child.message.role === "user");
				if (isResolved) setRequest(undefined);
			}
		},
	};
}

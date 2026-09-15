import { readFileSync } from "node:fs";

const fixedInstruction = readFileSync(new URL("./handoff-instruction.md", import.meta.url), "utf8");

export interface HandoffRuntime {
	handoffPath: string;
	initialPrompt: string;
	focus?: string;
}

export function createHandoffPrompt({ handoffPath, initialPrompt, focus }: HandoffRuntime) {
	const optionalFocus = focus === undefined ? "" : `\n\n## Optional focus\n\n${focus}`;
	return `${fixedInstruction}\n<handoff-runtime>\n\n## Handoff path\n\n${handoffPath}\n\n## Initial prompt\n\n${initialPrompt}${optionalFocus}\n</handoff-runtime>`;
}

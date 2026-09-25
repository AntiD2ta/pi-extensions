import { fauxAssistantMessage, fauxProvider, fauxToolCall, type Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function scriptedResponse(context: Context) {
  const latestUser = [...context.messages].reverse().find((message) => message.role === "user");
  const prompt = latestUser && typeof latestUser.content === "string"
    ? latestUser.content
    : latestUser?.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
  if (prompt.includes("tool") && context.messages.at(-1)?.role !== "toolResult") {
    return fauxAssistantMessage(
      fauxToolCall("bash", { command: "printf 'WORKING-BORDER-TOOL-COMPLETE\\n'" }),
      { stopReason: "toolUse" },
    );
  }
  return fauxAssistantMessage(
    "Working-border visual trial in progress. ".repeat(18)
      + "\n\n```typescript\nconst workingBorder = 'visible';\n```\n\nWorking-border trial complete.",
  );
}

export default function (pi: ExtensionAPI) {
  const faux = fauxProvider({
    provider: "working-border-faux",
    models: [{ id: "scripted", name: "Working Border Visual Trial", reasoning: false }],
    tokensPerSecond: 8,
    tokenSize: { min: 1, max: 1 },
  });
  faux.setResponses(Array.from({ length: 32 }, () => scriptedResponse));
  pi.registerProvider(faux.provider);
}

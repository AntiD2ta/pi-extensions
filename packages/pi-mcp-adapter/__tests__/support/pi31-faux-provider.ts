import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai";

const faux = fauxProvider({
  provider: "pi31-faux",
  models: [{ id: "smoke", name: "PI-31 MCP smoke", reasoning: false }],
});

const response: FauxResponseFactory = (context, _options, state) => {
  if (state.callCount % 2 === 0) return fauxAssistantMessage("PI-31 MCP card trial complete.");
  const prompt = JSON.stringify(context.messages.at(-1) ?? "").toLowerCase();
  const tool = prompt.includes("pending") || prompt.includes("delayed")
    ? "smoke_delayed"
    : prompt.includes("failed") || prompt.includes("failure") || prompt.includes("error")
      ? "smoke_failure"
      : "smoke_success";
  return fauxAssistantMessage([fauxToolCall("mcp", { tool, args: {} })]);
};

faux.setResponses(Array.from({ length: 40 }, () => response));

export default function (pi: { registerProvider(provider: unknown): void }) {
  pi.registerProvider(faux.provider);
}

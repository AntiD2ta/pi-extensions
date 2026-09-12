import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

/**
 * Smoke-test support for the `usage` segment. Registers a faux OAuth subscription provider
 * whose usage reports are scripted through POWERLINE_SMOKE_USAGE, so the footer can be
 * inspected without a network call, a real provider, or any credential.
 *
 * Modes: "ok" (default), "none" (no report), "empty" (no windows), "error", "slow".
 * Pair it with an auth.json entry for "faux-usage" in a throwaway PI_CODING_AGENT_DIR,
 * so Pi reports the provider as OAuth-backed. Every fetch is appended to
 * usage-fetch.log in that directory, so a trial can show when no fetch happens.
 */
const FIVE_HOURS = 5 * 60 * 60_000;
const ONE_HOUR = 60 * 60_000;

interface SmokeUsageReport {
  windows: { duration: number; used: number; observedAt: number; resetsAt: number }[];
}

function scriptedReport(): SmokeUsageReport {
  const observedAt = Date.now();
  return {
    windows: [
      { duration: FIVE_HOURS, used: 0.42, observedAt, resetsAt: observedAt + 72 * 60_000 + 30_000 },
      { duration: ONE_HOUR, used: 0.88, observedAt, resetsAt: observedAt + 18 * 60_000 + 30_000 },
    ],
  };
}

function recordFetch(mode: string): void {
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  if (!agentDir) return;
  appendFileSync(join(agentDir, "usage-fetch.log"), `${new Date().toISOString()} ${mode}\n`);
}

async function fetchScriptedUsageReport(request: { signal: AbortSignal }): Promise<SmokeUsageReport | undefined> {
  const mode = process.env.POWERLINE_SMOKE_USAGE ?? "ok";
  recordFetch(mode);
  if (mode === "none") return undefined;
  if (mode === "empty") return { windows: [] };
  if (mode === "error") throw new Error("scripted usage failure");
  if (mode === "slow") {
    return new Promise((resolve) => {
      request.signal.addEventListener("abort", () => resolve(undefined), { once: true });
    });
  }
  return scriptedReport();
}

export default function fauxUsageSmoke(pi: ExtensionAPI) {
  const faux = fauxProvider({
    provider: "faux-usage",
    models: [{ id: "scripted", name: "Faux Usage Scripted", reasoning: false, contextWindow: 200_000 }],
    tokensPerSecond: 12,
  });
  faux.setResponses([
    fauxAssistantMessage("SMOKE-ONE: deterministic response so the footer shows session token stats."),
    fauxAssistantMessage("SMOKE-TWO: deterministic response for a second turn."),
    fauxAssistantMessage("SMOKE-THREE: deterministic response for the narrow-width check."),
  ]);

  pi.registerProvider({
    ...faux.provider,
    name: "Faux Usage (scripted subscription)",
    auth: {
      oauth: {
        name: "Faux Usage (scripted subscription)",
        isSubscription: true,
        login: async () => ({
          type: "oauth" as const,
          access: "smoke-access",
          refresh: "smoke-refresh",
          expires: Date.now() + 60 * 60_000,
        }),
        refresh: async (credential) => credential,
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
    fetchUsageReport: fetchScriptedUsageReport,
  });
}

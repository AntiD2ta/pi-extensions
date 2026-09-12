import type { SubscriptionUsageWindow } from "./types.ts";

function waitForAbort(signal: AbortSignal): Promise<undefined> {
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(undefined), { once: true });
  });
}

/**
 * The provider-normalized usage report shape, declared locally because public Pi
 * does not export it. Fork revisions that lack `ModelRegistry.getUsageReport`
 * are handled by `getUsageReportSource`.
 */
export interface UsageReportLike {
  windows: readonly { duration: number; used: number; observedAt: number; resetsAt: number }[];
}

export interface UsageReportSource {
  getUsageReport(provider: string, options?: { signal?: AbortSignal }): Promise<UsageReportLike | undefined>;
}

/** A model registry only exposes usage reports on fork revisions that carry the forwarding method. */
export function getUsageReportSource(registry: unknown): UsageReportSource | null {
  if (typeof registry !== "object" || registry === null) return null;
  const getUsageReport = Reflect.get(registry, "getUsageReport");
  if (typeof getUsageReport !== "function") return null;

  return {
    getUsageReport: (provider, options) => getUsageReport.call(registry, provider, options),
  };
}

export interface SubscriptionUsageTrackerOptions {
  source: UsageReportSource;
  onUpdate: () => void;
  /** How long a report may take before the tracker gives up on it. */
  timeoutMs?: number;
  /** How long a fetched report stays fresh. */
  cacheTtlMs?: number;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 2_000;
// Matches pi-ai's own report cache, so a render-driven refresh never reaches the provider
// more often than the core already allows.
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

export class SubscriptionUsageTracker {
  private readonly source: UsageReportSource;
  private readonly onUpdate: () => void;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private cache: { provider: string; report: UsageReportLike | undefined; fetchedAt: number } | null = null;
  private inFlightProvider: string | null = null;

  constructor(options: SubscriptionUsageTrackerOptions) {
    this.source = options.source;
    this.onUpdate = options.onUpdate;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Read the configured window, refreshing in the background when the cache is missing or stale. */
  snapshot(provider: string | null, windowMs: number): SubscriptionUsageWindow | null {
    if (!provider) return null;
    if (this.cache?.provider !== provider) {
      this.refresh(provider);
      return null;
    }

    if (this.now() - this.cache.fetchedAt >= this.cacheTtlMs) {
      this.refresh(provider);
    }

    const window = this.cache.report?.windows.find((candidate) => candidate.duration === windowMs);
    return window ? { used: window.used, resetsAt: window.resetsAt } : null;
  }

  private refresh(provider: string): void {
    if (this.inFlightProvider === provider) return;
    this.inFlightProvider = provider;

    void (async () => {
      // A failed, unavailable, or slow report hides the segment instead of surfacing
      // an error or holding up a render.
      let report: UsageReportLike | undefined;
      const abort = new AbortController();
      const expiry = setTimeout(() => abort.abort(), this.timeoutMs);
      try {
        report = await Promise.race([
          this.source.getUsageReport(provider, { signal: abort.signal }),
          waitForAbort(abort.signal),
        ]);
      } catch {
        report = undefined;
      } finally {
        clearTimeout(expiry);
      }
      this.inFlightProvider = null;
      this.cache = { provider, report, fetchedAt: this.now() };
      this.onUpdate();
    })();
  }
}

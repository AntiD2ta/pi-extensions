import test from "node:test";
import assert from "node:assert/strict";
import { renderSegment } from "../segments.ts";
import { mergeSegmentOptions, parsePowerlineConfig } from "../powerline-config.ts";
import { getUsageReportSource, SubscriptionUsageTracker, type UsageReportLike } from "../usage-window.ts";
import type { SegmentContext, StatusLineSegmentOptions, SubscriptionUsageWindow } from "../types.ts";

const FIVE_HOURS = 5 * 60 * 60_000;

function report(windows: { duration: number; used: number; resetsAt: number }[]): UsageReportLike {
  return { windows: windows.map((window) => ({ ...window, observedAt: 0 })) };
}

/** Track tracker updates so a test can await the refresh the tracker started. */
function updateWaiter(): { onUpdate: () => void; next: () => Promise<void> } {
  let resolveNext: (() => void) | null = null;
  return {
    onUpdate: () => resolveNext?.(),
    next: () =>
      new Promise<void>((resolve) => {
        resolveNext = resolve;
      }),
  };
}

const originalNerdFonts = process.env.POWERLINE_NERD_FONTS;
process.env.POWERLINE_NERD_FONTS = "0";

test.after(() => {
  if (originalNerdFonts === undefined) {
    delete process.env.POWERLINE_NERD_FONTS;
  } else {
    process.env.POWERLINE_NERD_FONTS = originalNerdFonts;
  }
});

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function createSegmentContext(
  usageWindow: SubscriptionUsageWindow | null,
  options: StatusLineSegmentOptions = {},
): SegmentContext {
  return {
    model: undefined,
    thinkingLevel: "off",
    sessionId: undefined,
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, subagentCost: 0 },
    contextTokens: 0,
    contextPercent: 0,
    contextWindow: 0,
    contextApproximate: false,
    autoCompactEnabled: true,
    customCompactionEnabled: false,
    usingSubscription: true,
    usageWindow,
    queueSummary: { queueCount: 0, blockedCount: 0, compacting: false, leadingText: null, leadingIntent: null, leadingStatus: null },
    sessionStartTime: Date.now(),
    shellModeActive: false,
    shellRunning: false,
    shellName: null,
    shellCwd: null,
    git: { branch: null, staged: 0, unstaged: 0, untracked: 0 },
    extensionStatuses: new Map(),
    hiddenExtensionStatusKeys: new Set(),
    customItemsById: new Map(),
    options,
    theme: {
      fg: (_color: string, text: string) => text,
    },
    colors: {},
  };
}

// Half a minute of slack keeps the rendered countdown off a minute boundary.
const RESET_IN_72_MINUTES = () => Date.now() + 72 * 60_000 + 30_000;

test("usage segment shows the window percentage and time until reset", () => {
  const ctx = createSegmentContext({ used: 0.25, resetsAt: RESET_IN_72_MINUTES() });

  const rendered = renderSegment("usage", ctx);

  assert.equal(rendered.visible, true);
  assert.equal(stripAnsi(rendered.content), "sub 25% ⧗ 1h12m");
});

test("usage segment hides itself without a window", () => {
  const rendered = renderSegment("usage", createSegmentContext(null));

  assert.equal(rendered.visible, false);
  assert.equal(rendered.content, "");
});

test("tracker fetches once on first read, then exposes the configured window", { timeout: 2_000 }, async () => {
  const updates = updateWaiter();
  let calls = 0;
  const tracker = new SubscriptionUsageTracker({
    source: {
      getUsageReport: async () => {
        calls++;
        return report([{ duration: FIVE_HOURS, used: 0.4, resetsAt: 2_000 }]);
      },
    },
    onUpdate: updates.onUpdate,
  });

  const updated = updates.next();
  assert.equal(tracker.snapshot("anthropic", FIVE_HOURS), null);
  await updated;

  assert.deepEqual(tracker.snapshot("anthropic", FIVE_HOURS), { used: 0.4, resetsAt: 2_000 });
  assert.equal(calls, 1);
});

test("tracker shares one refresh between concurrent reads", { timeout: 2_000 }, async () => {
  const updates = updateWaiter();
  let calls = 0;
  let respond: ((value: UsageReportLike) => void) | null = null;
  const tracker = new SubscriptionUsageTracker({
    source: {
      getUsageReport: () => {
        calls++;
        return new Promise<UsageReportLike>((resolve) => {
          respond = resolve;
        });
      },
    },
    onUpdate: updates.onUpdate,
  });

  const updated = updates.next();
  tracker.snapshot("anthropic", FIVE_HOURS);
  tracker.snapshot("anthropic", FIVE_HOURS);
  tracker.snapshot("anthropic", FIVE_HOURS);
  assert.equal(calls, 1);

  respond?.(report([{ duration: FIVE_HOURS, used: 0.1, resetsAt: 3_000 }]));
  await updated;

  assert.deepEqual(tracker.snapshot("anthropic", FIVE_HOURS), { used: 0.1, resetsAt: 3_000 });
});

test("tracker hides the window when the report fails", { timeout: 2_000 }, async () => {
  const updates = updateWaiter();
  let calls = 0;
  const tracker = new SubscriptionUsageTracker({
    source: {
      getUsageReport: async () => {
        calls++;
        throw new Error("provider unreachable");
      },
    },
    onUpdate: updates.onUpdate,
  });

  const updated = updates.next();
  tracker.snapshot("anthropic", FIVE_HOURS);
  await updated;

  assert.equal(tracker.snapshot("anthropic", FIVE_HOURS), null);
  assert.equal(calls, 1);
});

test("tracker aborts a report that outlasts the UI wait", { timeout: 2_000 }, async () => {
  const updates = updateWaiter();
  let seenSignal: AbortSignal | undefined;
  const tracker = new SubscriptionUsageTracker({
    source: {
      getUsageReport: (_provider, options) =>
        new Promise<UsageReportLike>(() => {
          seenSignal = options?.signal;
        }),
    },
    onUpdate: updates.onUpdate,
    timeoutMs: 10,
  });

  const updated = updates.next();
  tracker.snapshot("anthropic", FIVE_HOURS);
  await updated;

  assert.equal(seenSignal?.aborted, true);
  assert.equal(tracker.snapshot("anthropic", FIVE_HOURS), null);
});

test("tracker keeps serving a cached window until it goes stale", { timeout: 2_000 }, async () => {
  const updates = updateWaiter();
  const used = [0.1, 0.2];
  let now = 1_000;
  const tracker = new SubscriptionUsageTracker({
    source: {
      getUsageReport: async () => report([{ duration: FIVE_HOURS, used: used.shift() ?? 0, resetsAt: 9_000 }]),
    },
    onUpdate: updates.onUpdate,
    cacheTtlMs: 60_000,
    now: () => now,
  });

  let updated = updates.next();
  tracker.snapshot("anthropic", FIVE_HOURS);
  await updated;
  assert.deepEqual(tracker.snapshot("anthropic", FIVE_HOURS), { used: 0.1, resetsAt: 9_000 });

  now += 59_000;
  assert.deepEqual(tracker.snapshot("anthropic", FIVE_HOURS), { used: 0.1, resetsAt: 9_000 });

  now += 2_000;
  updated = updates.next();
  assert.deepEqual(tracker.snapshot("anthropic", FIVE_HOURS), { used: 0.1, resetsAt: 9_000 });
  await updated;

  assert.deepEqual(tracker.snapshot("anthropic", FIVE_HOURS), { used: 0.2, resetsAt: 9_000 });
});

test("tracker shows only the configured duration", { timeout: 2_000 }, async () => {
  const updates = updateWaiter();
  const tracker = new SubscriptionUsageTracker({
    source: {
      getUsageReport: async () =>
        report([
          { duration: 60 * 60_000, used: 0.8, resetsAt: 4_000 },
          { duration: FIVE_HOURS, used: 0.3, resetsAt: 8_000 },
        ]),
    },
    onUpdate: updates.onUpdate,
  });

  const updated = updates.next();
  tracker.snapshot("anthropic", FIVE_HOURS);
  await updated;

  assert.deepEqual(tracker.snapshot("anthropic", FIVE_HOURS), { used: 0.3, resetsAt: 8_000 });
  assert.equal(tracker.snapshot("anthropic", 3 * 60 * 60_000), null);
});

test("tracker shows nothing for an account without finite windows", { timeout: 2_000 }, async () => {
  const updates = updateWaiter();
  const tracker = new SubscriptionUsageTracker({
    source: { getUsageReport: async () => undefined },
    onUpdate: updates.onUpdate,
  });

  const updated = updates.next();
  tracker.snapshot("anthropic", FIVE_HOURS);
  await updated;

  assert.equal(tracker.snapshot("anthropic", FIVE_HOURS), null);
});

test("tracker refetches when the provider changes", { timeout: 2_000 }, async () => {
  const updates = updateWaiter();
  const providers: string[] = [];
  const tracker = new SubscriptionUsageTracker({
    source: {
      getUsageReport: async (provider) => {
        providers.push(provider);
        return report([{ duration: FIVE_HOURS, used: provider === "anthropic" ? 0.3 : 0.7, resetsAt: 8_000 }]);
      },
    },
    onUpdate: updates.onUpdate,
  });

  let updated = updates.next();
  tracker.snapshot("anthropic", FIVE_HOURS);
  await updated;
  assert.deepEqual(tracker.snapshot("anthropic", FIVE_HOURS), { used: 0.3, resetsAt: 8_000 });

  updated = updates.next();
  assert.equal(tracker.snapshot("openai-codex", FIVE_HOURS), null);
  await updated;

  assert.deepEqual(tracker.snapshot("openai-codex", FIVE_HOURS), { used: 0.7, resetsAt: 8_000 });
  assert.deepEqual(providers, ["anthropic", "openai-codex"]);
});

test("tracker picks up a report that succeeds after an earlier timeout", { timeout: 2_000 }, async () => {
  const updates = updateWaiter();
  let now = 1_000;
  let attempts = 0;
  const tracker = new SubscriptionUsageTracker({
    source: {
      getUsageReport: (_provider, options) => {
        attempts++;
        if (attempts === 1) {
          return new Promise<UsageReportLike>(() => {
            void options?.signal;
          });
        }
        return Promise.resolve(report([{ duration: FIVE_HOURS, used: 0.5, resetsAt: 8_000 }]));
      },
    },
    onUpdate: updates.onUpdate,
    timeoutMs: 10,
    cacheTtlMs: 60_000,
    now: () => now,
  });

  let updated = updates.next();
  tracker.snapshot("anthropic", FIVE_HOURS);
  await updated;
  assert.equal(tracker.snapshot("anthropic", FIVE_HOURS), null);

  now += 61_000;
  updated = updates.next();
  tracker.snapshot("anthropic", FIVE_HOURS);
  await updated;

  assert.deepEqual(tracker.snapshot("anthropic", FIVE_HOURS), { used: 0.5, resetsAt: 8_000 });
});

test("usage reports are unavailable on a registry without the forwarding method", () => {
  assert.equal(getUsageReportSource(undefined), null);
  assert.equal(getUsageReportSource({ isUsingOAuth: () => true }), null);
});

test("usage reports are read through the registry that owns them", { timeout: 2_000 }, async () => {
  const registry = {
    plan: report([{ duration: FIVE_HOURS, used: 0.6, resetsAt: 7_000 }]),
    async getUsageReport(this: { plan: UsageReportLike }) {
      return this.plan;
    },
  };

  const source = getUsageReportSource(registry);

  assert.notEqual(source, null);
  assert.deepEqual(await source?.getUsageReport("anthropic"), registry.plan);
});

test("usage window hours and format are configurable, invalid values ignored", () => {
  const configured = parsePowerlineConfig({ usage: { windowHours: 1, format: "percent" } }, ["default"]);
  assert.deepEqual(configured.segmentOptions.usage, { windowHours: 1, format: "percent" });

  const invalid = parsePowerlineConfig({ usage: { windowHours: 0, format: "wide" } }, ["default"]);
  assert.deepEqual(invalid.segmentOptions.usage, {});

  assert.deepEqual(
    mergeSegmentOptions({ usage: { windowHours: 5 } }, { usage: { format: "percent" } }).usage,
    { windowHours: 5, format: "percent" },
  );
});

test("usage segment drops the countdown in percent format", () => {
  const ctx = createSegmentContext(
    { used: 0.25, resetsAt: RESET_IN_72_MINUTES() },
    { usage: { format: "percent" } },
  );

  const rendered = renderSegment("usage", ctx);

  assert.equal(stripAnsi(rendered.content), "sub 25%");
});

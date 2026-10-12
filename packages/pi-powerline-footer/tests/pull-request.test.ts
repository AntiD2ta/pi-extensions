import test from "node:test";
import assert from "node:assert/strict";
import { resetCapabilitiesCache, setCapabilities, visibleWidth } from "@earendil-works/pi-tui";
import { renderSegment } from "../segments.ts";
import { parsePowerlineConfig } from "../powerline-config.ts";
import type { SegmentContext } from "../types.ts";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGitPullRequest, invalidateGitBranch, invalidateGitPullRequest, subscribeGitUpdates, waitForGitUpdates } from "../git-status.ts";

function context(): SegmentContext {
  return {
    model: undefined, thinkingLevel: "off", sessionId: undefined,
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, subagentCost: 0 },
    contextTokens: 0, contextPercent: 0, contextWindow: 0, contextApproximate: false,
    autoCompactEnabled: false, customCompactionEnabled: false, usingSubscription: false,
    usageWindow: null,
    queueSummary: { queueCount: 0, blockedCount: 0, compacting: false, leadingText: null, leadingIntent: null, leadingStatus: null },
    sessionStartTime: 0, shellModeActive: false, shellRunning: false, shellName: null, shellCwd: null,
    git: { branch: "feature", staged: 1, unstaged: 0, untracked: 0 },
    extensionStatuses: new Map(), hiddenExtensionStatusKeys: new Set(), customItemsById: new Map(),
    options: {}, theme: { fg: (_color, text) => text }, colors: {},
  };
}

test("Git segment underlines only the PR hyperlink between the branch and counts", (t) => {
  t.after(resetCapabilitiesCache);
  setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  const ctx = context();
  Object.assign(ctx.git, { pullRequest: { number: 123, url: "https://github.com/owner/repo/pull/123" } });
  const content = renderSegment("git", ctx).content;
  assert.match(content, /feature.*\x1b\]8;;https:\/\/github.com\/owner\/repo\/pull\/123\x1b\\\x1b\[4mPR #123\x1b\[24m\x1b\]8;;\x1b\\.*\+1/);
  assert.equal(content.split("\x1b[4m").length - 1, 1);
  assert.equal(visibleWidth(content), visibleWidth(renderSegment("git", context()).content) + " PR #123".length);
});

test("PR label respects the opt-out and unsupported terminals", (t) => {
  t.after(resetCapabilitiesCache);
  const ctx = context();
  Object.assign(ctx.git, { pullRequest: { number: 123, url: "https://github.com/owner/repo/pull/123" } });
  ctx.options.git = { showPullRequest: false };
  assert.doesNotMatch(renderSegment("git", ctx).content, /PR #/);
  ctx.options.git = {};
  setCapabilities({ images: null, trueColor: true, hyperlinks: false });
  assert.match(renderSegment("git", ctx).content, /PR #123/);
  assert.doesNotMatch(renderSegment("git", ctx).content, /\x1b\]8;|\x1b\[4m/);
});

test("PR opt-out is parsed from settings without accepting non-booleans", () => {
  assert.equal(parsePowerlineConfig({ git: { showPullRequest: false } }, ["default"]).segmentOptions.git?.showPullRequest, false);
  assert.equal(parsePowerlineConfig({ git: { showPullRequest: "false" } }, ["default"]).segmentOptions.git?.showPullRequest, undefined);
});

function github(t: test.TestContext, response: () => unknown) {
  const spawn = childProcess.spawn;
  const requests: Parameters<typeof spawn>[] = [];
  t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    if (args[0] !== "gh") return spawn(...args);
    requests.push(args);
    const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: () => true }) as ReturnType<typeof spawn>;
    queueMicrotask(() => {
      proc.emit("spawn");
      const result = response();
      if (result instanceof Error) proc.emit("error", result);
      else {
        proc.stdout.emit("data", JSON.stringify(result));
        proc.emit("close", 0);
      }
    });
    return proc;
  });
  syncBuiltinESMExports();
  t.after(async () => {
    await waitForGitUpdates();
    invalidateGitBranch(); invalidateGitPullRequest();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return requests;
}

test("open branch PR is fetched in the session directory and cached", async (t) => {
  const pr = { number: 123, url: "https://github.com/owner/repo/pull/123", state: "OPEN", headRefName: "feature" };
  const requests = github(t, () => pr);
  const cwd = process.cwd();
  invalidateGitBranch(); invalidateGitPullRequest();
  assert.equal(getGitPullRequest("feature", cwd), null);
  await waitForGitUpdates();
  assert.deepEqual(getGitPullRequest("feature", cwd), { number: pr.number, url: pr.url });
  getGitPullRequest("feature", cwd);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][2]?.cwd, cwd);
});

test("closed, merged and unsafe PR data stays hidden and negative-cached", async (t) => {
  let response: unknown;
  const requests = github(t, () => response);
  const valid = { number: 123, url: "https://github.com/owner/repo/pull/123", headRefName: "feature", state: "OPEN" };
  for (response of [
    { ...valid, state: "CLOSED" }, { ...valid, state: "MERGED" },
    { ...valid, number: -1 }, { ...valid, url: "javascript:alert(1)" },
    { ...valid, url: "https://github.com/owner/repo/pull/123\x1b\\" }, null,
  ]) {
    invalidateGitBranch(); invalidateGitPullRequest();
    const before = requests.length;
    getGitPullRequest("feature");
    await waitForGitUpdates();
    assert.equal(getGitPullRequest("feature"), null);
    assert.equal(requests.length, before + 1);
  }
});

test("expired PR data refreshes without repainting unchanged results", async (t) => {
  const pr = { number: 123, url: "https://github.com/owner/repo/pull/123", headRefName: "feature", state: "OPEN" };
  const requests = github(t, () => pr);
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  invalidateGitBranch(); invalidateGitPullRequest();
  getGitPullRequest("feature");
  await waitForGitUpdates();
  let updates = 0;
  t.after(subscribeGitUpdates(() => { updates++; }));
  now += 60_000;
  getGitPullRequest("feature");
  await waitForGitUpdates();
  assert.equal(requests.length, 2);
  assert.equal(updates, 0);
  assert.equal(getGitPullRequest("feature")?.number, 123);
});

test("missing or unauthenticated gh stays hidden and retries only after cache expiry", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const requests = github(t, () => new Error("gh unavailable"));
  invalidateGitBranch(); invalidateGitPullRequest();
  getGitPullRequest("feature");
  await waitForGitUpdates();
  assert.equal(getGitPullRequest("feature"), null);
  assert.equal(requests.length, 1);
  now += 60_000;
  getGitPullRequest("feature");
  await waitForGitUpdates();
  assert.equal(requests.length, 2);
});

test("late PR lookups cannot repopulate a switched branch or disposed footer", async (t) => {
  const releases: (() => void)[] = [];
  t.mock.method(childProcess, "spawn", () => {
    const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: () => true }) as ReturnType<typeof childProcess.spawn>;
    const number = releases.length + 1;
    const headRefName = number === 1 ? "old" : "new";
    releases.push(() => {
      proc.stdout.emit("data", JSON.stringify({ number, url: `https://github.com/owner/repo/pull/${number}`, state: "OPEN", headRefName }));
      proc.emit("close", 0);
    });
    queueMicrotask(() => proc.emit("spawn"));
    return proc;
  });
  syncBuiltinESMExports();
  t.after(() => { invalidateGitBranch(); invalidateGitPullRequest(); t.mock.restoreAll(); syncBuiltinESMExports(); });
  invalidateGitBranch(); invalidateGitPullRequest();
  getGitPullRequest("old", "/tmp/repo-old");
  const old = waitForGitUpdates();
  getGitPullRequest("new", "/tmp/repo-old");
  const current = waitForGitUpdates();
  await Promise.resolve();
  releases[0]();
  await old;
  assert.equal(getGitPullRequest("new", "/tmp/repo-old"), null);
  releases[1]();
  await current;
  assert.equal(getGitPullRequest("new", "/tmp/repo-old")?.number, 2);
  invalidateGitPullRequest();
  getGitPullRequest("new", "/tmp/repo-old");
  const disposed = waitForGitUpdates();
  invalidateGitPullRequest();
  await Promise.resolve();
  releases[2]();
  await disposed;
  assert.equal(getGitPullRequest("new", "/tmp/repo-old"), null);
  const cleanup = waitForGitUpdates();
  await Promise.resolve();
  releases[3]();
  await cleanup;
});

test("slow gh is bounded by its execution deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  let killed = false;
  t.mock.method(childProcess, "spawn", () => {
    const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: () => { killed = true; return true; } }) as ReturnType<typeof childProcess.spawn>;
    queueMicrotask(() => proc.emit("spawn"));
    return proc;
  });
  syncBuiltinESMExports();
  t.after(() => { invalidateGitBranch(); invalidateGitPullRequest(); t.mock.restoreAll(); syncBuiltinESMExports(); });
  invalidateGitBranch(); invalidateGitPullRequest();
  getGitPullRequest("feature");
  await Promise.resolve();
  t.mock.timers.tick(5000);
  await waitForGitUpdates();
  assert.ok(killed);
  assert.equal(getGitPullRequest("feature"), null);
});

test("oversized CLI output cannot be rendered as a PR", async (t) => {
  github(t, () => ({ number: 123, url: "https://github.com/owner/repo/pull/123", headRefName: "feature", state: "OPEN", padding: "x".repeat(70_000) }));
  invalidateGitBranch(); invalidateGitPullRequest();
  getGitPullRequest("feature");
  await waitForGitUpdates();
  assert.equal(getGitPullRequest("feature"), null);
});

test("fallback branch polling keeps a confirmed PR visible until the branch changes", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "powerline-pr-fallback-"));
  childProcess.execFileSync("git", ["init", "-q", "-b", "feature"], { cwd });
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  let number = 123;
  github(t, () => ({ number, url: `https://github.com/owner/repo/pull/${number}`, state: "OPEN" }));
  getGitPullRequest(null, cwd);
  await waitForGitUpdates();
  getGitPullRequest(null, cwd);
  await waitForGitUpdates();
  assert.equal(getGitPullRequest(null, cwd)?.number, 123);
  now += 60_000;
  const updates: ReturnType<typeof getGitPullRequest>[] = [];
  t.after(subscribeGitUpdates(() => { updates.push(getGitPullRequest(null, cwd)); }));
  getGitPullRequest(null, cwd);
  await waitForGitUpdates();
  await waitForGitUpdates();
  now += 500;
  assert.equal(getGitPullRequest(null, cwd)?.number, 123);
  await waitForGitUpdates();
  childProcess.execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/other"], { cwd });
  number = 124;
  now += 500;
  getGitPullRequest(null, cwd);
  await waitForGitUpdates();
  assert.ok(updates.includes(null), "observed branch changes clear the label before the next PR lookup");
  await waitForGitUpdates();
  assert.equal(getGitPullRequest(null, cwd)?.number, 124);
});


test("PR resolution follows gh when the local branch has a different name", async (t) => {
  github(t, () => ({ number: 123, url: "https://github.com/owner/repo/pull/123", state: "OPEN", headRefName: "remote-feature" }));
  invalidateGitBranch(); invalidateGitPullRequest();
  getGitPullRequest("local-feature");
  await waitForGitUpdates();
  assert.equal(getGitPullRequest("local-feature")?.number, 123);
});

test("nonzero gh exit is negative-cached", async (t) => {
  let requests = 0;
  t.mock.method(childProcess, "spawn", () => {
    requests++;
    const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: () => true }) as ReturnType<typeof childProcess.spawn>;
    queueMicrotask(() => { proc.emit("spawn"); proc.emit("close", 1); });
    return proc;
  });
  syncBuiltinESMExports();
  t.after(() => { invalidateGitPullRequest(); t.mock.restoreAll(); syncBuiltinESMExports(); });
  getGitPullRequest("feature");
  await waitForGitUpdates();
  assert.equal(getGitPullRequest("feature"), null);
  assert.equal(requests, 1);
});

test("CLI lookup disables forced color and terminal prompts", async (t) => {
  const requests = github(t, () => null);
  getGitPullRequest("feature");
  await waitForGitUpdates();
  const env = requests[0][2]?.env;
  assert.equal(env?.GH_PROMPT_DISABLED, "1");
  assert.equal(env?.GH_FORCE_TTY, "");
  assert.equal(env?.NO_COLOR, "1");
  assert.equal(env?.CLICOLOR_FORCE, "0");
});

test("same-named branches in different repositories do not share PR data", async (t) => {
  let number = 123;
  github(t, () => ({ number, url: `https://github.com/owner/repo/pull/${number}`, state: "OPEN" }));
  getGitPullRequest("feature", "/tmp/repo-a");
  await waitForGitUpdates();
  assert.equal(getGitPullRequest("feature", "/tmp/repo-a")?.number, 123);
  number = 124;
  assert.equal(getGitPullRequest("feature", "/tmp/repo-b"), null);
  await waitForGitUpdates();
  assert.equal(getGitPullRequest("feature", "/tmp/repo-b")?.number, 124);
});

test("detached HEAD and non-git directories never query gh", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "powerline-pr-detached-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const requests = github(t, () => null);
  getGitPullRequest(null, cwd);
  await waitForGitUpdates();
  assert.equal(getGitPullRequest(null, cwd), null);
  childProcess.execFileSync("git", ["init", "-q", "-b", "feature"], { cwd });
  childProcess.execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-qm", "fixture"], { cwd });
  childProcess.execFileSync("git", ["checkout", "-q", "--detach"], { cwd });
  getGitPullRequest("detached", cwd);
  await waitForGitUpdates();
  assert.equal(getGitPullRequest("detached", cwd), null);
  assert.equal(requests.length, 0);
});

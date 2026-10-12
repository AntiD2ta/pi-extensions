import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { GitStatus } from "./types.ts";

interface CachedGitStatus {
  staged: number;
  unstaged: number;
  untracked: number;
  timestamp: number;
}

interface CachedBranch {
  branch: string | null;
  timestamp: number;
}

export type GitPollingMode = "full" | "branch" | "off";

/** Known git hosting providers we render a dedicated icon for. */
export type GitHost = "github" | "gitlab" | "bitbucket" | "other";

interface CachedRemoteHost {
  host: GitHost | null;
  timestamp: number;
}

const CACHE_TTL_MS = 1000; // 1 second for file status
const BRANCH_TTL_MS = 500; // Shorter TTL so branch updates quickly after invalidation
const PULL_REQUEST_TTL_MS = 60_000;
const PULL_REQUEST_TIMEOUT_MS = 5000;
const PULL_REQUEST_OUTPUT_LIMIT = 64 * 1024;
const REMOTE_TTL_MS = 60_000; // Origin remote almost never changes within a session
let cachedStatus: CachedGitStatus | null = null;
let cachedBranch: CachedBranch | null = null;
let cachedRemoteHost: CachedRemoteHost | null = null;
let cachedPullRequest: { value: GitStatus["pullRequest"]; timestamp: number } | null = null;
let pendingPullRequestFetch: Promise<void> | null = null;
let pullRequestGeneration = 0;
let pullRequestBranch: string | null = null;
let pullRequestRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRemoteFetch: Promise<void> | null = null;
let pendingFetch: Promise<void> | null = null;
let pendingBranchFetch: Promise<void> | null = null;
let invalidationCounter = 0; // Track invalidations to prevent stale updates
let branchInvalidationCounter = 0;
let currentCwd: string | null = null;
let lastProviderBranch: string | null = null;
const updateListeners = new Set<() => void>();

// Serve-stale is only valid within one cwd. Detach old requests as well as
// clearing their data, so they cannot publish into or block the new cwd.
function useCwd(cwd: string): string {
  cwd = resolve(cwd);
  if (cwd === currentCwd) return cwd;

  currentCwd = cwd;
  invalidateGitStatus();
  invalidateGitBranch();
  invalidateGitPullRequest();
  cachedStatus = null;
  cachedBranch = null;
  lastProviderBranch = null;
  return cwd;
}

/** Wait for the background reads already requested by synchronous getters. */
export async function waitForGitUpdates(): Promise<void> {
  await Promise.all([pendingFetch, pendingBranchFetch, pendingRemoteFetch, pendingPullRequestFetch]);
}

// Completed reads publish only visible changes. PR expiry also requests a render
// so the next lookup runs while idle.
function notifyGitUpdate(): void {
  for (const listener of updateListeners) listener();
}

export function subscribeGitUpdates(listener: () => void): () => void {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

/**
 * Parse git status --porcelain output
 * 
 * Format: XY filename
 * X = index status, Y = working tree status
 * ?? = untracked
 * Other X values = staged
 * Other Y values = unstaged
 */
function parseGitStatusOutput(output: string): { staged: number; unstaged: number; untracked: number } {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of output.split("\n")) {
    if (!line) continue;
    const x = line[0];
    const y = line[1];

    if (x === "?" && y === "?") {
      untracked++;
      continue;
    }

    // X position (index/staged)
    if (x && x !== " " && x !== "?") {
      staged++;
    }

    // Y position (working tree/unstaged)
    if (y && y !== " ") {
      unstaged++;
    }
  }

  return { staged, unstaged, untracked };
}

/**
 * Environment for this module's read-only git commands.
 *
 * Polling `git status` otherwise refreshes the index as a side effect, taking
 * `.git/index.lock`: that races interactive git in the same repo, and orphans
 * the lock if we are killed mid-write. `GIT_OPTIONAL_LOCKS=0` skips the
 * refresh; the reported counts are unchanged. Preferred over
 * `--no-optional-locks` because it also reaches the child git processes
 * `status` spawns for submodules.
 */
export function readOnlyGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, GIT_OPTIONAL_LOCKS: "0" };
}

function runReadOnlyCommand(command: string, args: string[], cwd: string, timeoutMs = 200, maxOutputLength = Infinity): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: command === "gh"
        ? { ...readOnlyGitEnv(), GH_PROMPT_DISABLED: "1", GH_FORCE_TTY: "", NO_COLOR: "1", CLICOLOR_FORCE: "0" }
        : readOnlyGitEnv(),
      windowsHide: true,
      cwd,
    });

    let stdout = "";
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: string | null) => {
      if (resolved) return;
      resolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve(result);
    };

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
      if (stdout.length > maxOutputLength) {
        proc.kill();
        finish(null);
      }
    });

    proc.on("close", (code) => {
      finish(code === 0 ? stdout.trimEnd() : null);
    });

    proc.on("error", () => {
      finish(null);
    });

    // Process creation can be delayed by the OS. Limit execution only after
    // the child has started, so a delayed start does not consume its deadline.
    proc.once("spawn", () => {
      timeoutId = setTimeout(() => {
        proc.kill();
        finish(null);
      }, timeoutMs);
    });
  });
}

/**
 * Fetch current git branch asynchronously.
 * For detached HEAD, returns the short commit SHA (matches provider's "detached" behavior).
 */
async function fetchGitBranch(cwd: string): Promise<string | null> {
  const branch = await runReadOnlyCommand("git", ["symbolic-ref", "--short", "HEAD"], cwd, 500);
  if (branch) return branch;

  const sha = await runReadOnlyCommand("git", ["rev-parse", "--short", "HEAD"], cwd, 500);
  return sha ? `${sha} (detached)` : null;
}

/**
 * Classify an origin remote URL into a known hosting provider. Handles both
 * SSH (`git@host:owner/repo`, `ssh://git@host/…`) and HTTP(S) forms, and
 * treats sub-domains (e.g. `www.github.com`) and any non-empty remote we
 * don't recognize as a generic git host.
 */
export function detectGitHost(remoteUrl: string | null): GitHost | null {
  if (!remoteUrl) return null;
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  let host: string;
  const scpLike = /^[^/@]+@([^:/]+):/.exec(trimmed);
  if (scpLike) {
    host = scpLike[1]!;
  } else {
    try {
      host = new URL(trimmed).hostname;
    } catch {
      return "other";
    }
  }

  host = host.toLowerCase().replace(/^www\./, "");
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab";
  if (host === "bitbucket.org" || host.endsWith(".bitbucket.org")) return "bitbucket";
  return "other";
}

/**
 * Get the origin remote's hosting provider with a long TTL cache. Returns the
 * cached value immediately (or null before the first fetch completes) and
 * refreshes in the background, matching the branch/status caching pattern.
 */
export function getGitRemoteHost(cwd = process.cwd()): GitHost | null {
  cwd = useCwd(cwd);
  const now = Date.now();
  if (cachedRemoteHost && now - cachedRemoteHost.timestamp < REMOTE_TTL_MS) {
    return cachedRemoteHost.host;
  }

  if (!pendingRemoteFetch) {
    const fetchId = branchInvalidationCounter;
    pendingRemoteFetch = runReadOnlyCommand("git", ["remote", "get-url", "origin"], cwd, 1000).then(detectGitHost)
      .then((host) => {
        if (fetchId !== branchInvalidationCounter) return;
        const changed = (cachedRemoteHost?.host ?? null) !== host;
        cachedRemoteHost = { host, timestamp: Date.now() };
        if (changed) notifyGitUpdate();
      })
      .catch(() => {
        if (fetchId !== branchInvalidationCounter) return;
        const changed = (cachedRemoteHost?.host ?? null) !== null;
        cachedRemoteHost = { host: null, timestamp: Date.now() };
        if (changed) notifyGitUpdate();
      })
      .finally(() => {
        if (fetchId === branchInvalidationCounter) pendingRemoteFetch = null;
      });
  }

  return cachedRemoteHost ? cachedRemoteHost.host : null;
}

/**
 * Fetch git status asynchronously
 */
async function fetchGitStatus(cwd: string): Promise<{ staged: number; unstaged: number; untracked: number } | null> {
  const output = await runReadOnlyCommand("git", ["status", "--porcelain"], cwd, 1000);
  if (output === null) return null;
  return parseGitStatusOutput(output);
}

/**
 * Get the current git branch with caching.
 * Reuse Pi's attached branch; poll only when unavailable or detached.
 * The provider value must belong to the supplied cwd.
 */
export function getCurrentBranch(providerBranch: string | null, cwd = process.cwd()): string | null {
  cwd = useCwd(cwd);
  if (providerBranch !== lastProviderBranch) {
    invalidateGitBranch();
    invalidateGitPullRequest();
    invalidateGitStatus();
    cachedBranch = null;
    lastProviderBranch = providerBranch;
  }
  if (providerBranch && providerBranch !== "detached") return providerBranch;
  const now = Date.now();

  // Return cached if fresh
  if (cachedBranch && now - cachedBranch.timestamp < BRANCH_TTL_MS) {
    return cachedBranch.branch;
  }

  // Trigger background fetch if not already pending
  if (!pendingBranchFetch) {
    const fetchId = branchInvalidationCounter;
    pendingBranchFetch = fetchGitBranch(cwd).then((result) => {
      // Cache result if no invalidation happened (including null for non-git dirs)
      if (fetchId === branchInvalidationCounter) {
        const changed = (cachedBranch ? cachedBranch.branch : providerBranch) !== result;
        if (changed) invalidateGitPullRequest();
        cachedBranch = {
          branch: result,
          timestamp: Date.now(),
        };
        pendingBranchFetch = null;
        if (changed || pullRequestBranch && (!cachedPullRequest || Date.now() - cachedPullRequest.timestamp >= PULL_REQUEST_TTL_MS)) notifyGitUpdate();
      }
    });
  }

  // Return stale cache while refreshing; only use provider before first fetch
  return cachedBranch ? cachedBranch.branch : providerBranch;
}

/**
 * Get git status with caching.
 * Returns cached value if within TTL, otherwise triggers async fetch.
 * This is designed for synchronous render() calls - returns last known value
 * while refreshing in background.
 */
export function getGitStatus(providerBranch: string | null, pollingMode: GitPollingMode = "full", cwd = process.cwd()): GitStatus {
  cwd = useCwd(cwd);
  const now = Date.now();
  const branch = pollingMode === "off" ? providerBranch : getCurrentBranch(providerBranch, cwd);

  if (pollingMode !== "full") {
    return { branch, staged: 0, unstaged: 0, untracked: 0 };
  }

  // Refresh expired data in the background, serving the last known counts.
  if (!pendingFetch && (!cachedStatus || now - cachedStatus.timestamp >= CACHE_TTL_MS)) {
    const fetchId = invalidationCounter; // Capture current counter
    pendingFetch = fetchGitStatus(cwd).then((result) => {
      // Cache result if no invalidation happened (including null for non-git dirs)
      if (fetchId === invalidationCounter) {
        const nextStatus = result
          ? { staged: result.staged, unstaged: result.unstaged, untracked: result.untracked, timestamp: Date.now() }
          : { staged: 0, unstaged: 0, untracked: 0, timestamp: Date.now() };
        const changed = !cachedStatus
          ? nextStatus.staged !== 0 || nextStatus.unstaged !== 0 || nextStatus.untracked !== 0
          : cachedStatus.staged !== nextStatus.staged
            || cachedStatus.unstaged !== nextStatus.unstaged
            || cachedStatus.untracked !== nextStatus.untracked;
        cachedStatus = nextStatus;
        if (changed) notifyGitUpdate();
      }
      if (fetchId === invalidationCounter) pendingFetch = null;
    });
  }

  // Return last cached or empty
  if (cachedStatus) {
    return { 
      branch, 
      staged: cachedStatus.staged,
      unstaged: cachedStatus.unstaged,
      untracked: cachedStatus.untracked,
    };
  }

  return { branch, staged: 0, unstaged: 0, untracked: 0 };
}

export function getGitPullRequest(providerBranch: string | null, cwd = process.cwd()): GitStatus["pullRequest"] {
  cwd = useCwd(cwd);
  const branch = getCurrentBranch(providerBranch, cwd);
  if (!branch || branch === "detached" || branch.endsWith(" (detached)")) return null;
  if (pullRequestBranch !== branch) {
    invalidateGitPullRequest();
    pullRequestBranch = branch;
  }
  if (pendingBranchFetch) return cachedPullRequest?.value ?? null;
  if (cachedPullRequest && Date.now() - cachedPullRequest.timestamp < PULL_REQUEST_TTL_MS) return cachedPullRequest.value;

  if (!pendingPullRequestFetch) {
    const fetchId = pullRequestGeneration;
    pendingPullRequestFetch = runReadOnlyCommand("gh", ["pr", "view", "--json", "number,url,state"], cwd, PULL_REQUEST_TIMEOUT_MS, PULL_REQUEST_OUTPUT_LIMIT)
      .then((output) => {
        if (fetchId !== pullRequestGeneration) return;
        let value: GitStatus["pullRequest"] = null;
        try {
          const pr: unknown = output === null ? null : JSON.parse(output);
          if (pr && typeof pr === "object" && "number" in pr && "url" in pr && "state" in pr
            && pr.state === "OPEN" && typeof pr.number === "number"
            && Number.isSafeInteger(pr.number) && pr.number > 0 && typeof pr.url === "string"
            && !/[\x00-\x20\x7f-\x9f]/.test(pr.url)) {
            const url = new URL(pr.url);
            if (url.protocol === "https:" && !url.username && !url.password) value = { number: pr.number, url: pr.url };
          }
        } catch {
          // Invalid CLI output is unavailable PR data, not a footer failure.
        }
        const changed = cachedPullRequest?.value?.number !== value?.number || cachedPullRequest?.value?.url !== value?.url;
        cachedPullRequest = { value, timestamp: Date.now() };
        if (pullRequestRefreshTimer) clearTimeout(pullRequestRefreshTimer);
        pullRequestRefreshTimer = setTimeout(() => {
          pullRequestRefreshTimer = null;
          if (cachedPullRequest) cachedPullRequest.timestamp = 0;
          notifyGitUpdate();
        }, PULL_REQUEST_TTL_MS);
        pullRequestRefreshTimer.unref();
        if (changed) notifyGitUpdate();
      })
      .finally(() => {
        if (fetchId === pullRequestGeneration) pendingPullRequestFetch = null;
      });
  }
  return cachedPullRequest?.value ?? null;
}

export function invalidateGitPullRequest(): void {
  pullRequestGeneration++;
  pullRequestBranch = null;
  if (pullRequestRefreshTimer) clearTimeout(pullRequestRefreshTimer);
  pullRequestRefreshTimer = null;
  cachedPullRequest = null;
  pendingPullRequestFetch = null;
}

/**
 * Force refresh git status (call when you know files changed).
 * Serve-stale: keep the last known counts on screen while a background
 * refresh runs, instead of blanking the segment to zeros (footer flicker).
 */
export function invalidateGitStatus(): void {
  if (cachedStatus) cachedStatus.timestamp = 0; // expire, but keep serving the stale value
  invalidationCounter++; // Increment to invalidate any pending fetches
  pendingFetch = null;
}

/**
 * Force refresh git branch (call when you know branch might have changed).
 * Serve-stale: keep showing the last known branch until the refresh lands.
 */
export function invalidateGitBranch(): void {
  if (cachedBranch) cachedBranch.timestamp = 0; // expire, but keep serving the stale value
  branchInvalidationCounter++;
  pendingBranchFetch = null;
  // The origin remote is repo-scoped, so a branch/cwd change may mean a
  // different repo; drop the host cache so it re-detects.
  cachedRemoteHost = null;
  pendingRemoteFetch = null;
}

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setImmediate } from "node:timers/promises";
import { PowerlineQueueStore } from "../queue/store.ts";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { codingAgentModuleUrl } from "./pi-modules.ts";

// Run against a supported real SDK, not a fabricated compaction lifecycle.
// PI_COMPACTION_SDK=/path/to/pi-coding-agent/dist/index.js node --experimental-strip-types --test tests/post-compaction-queue.test.ts
const sdkPath = process.env.PI_COMPACTION_SDK;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

async function readinessHarness(t) {
  const root = mkdtempSync(join(tmpdir(), "powerline-readiness-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  writeFileSync(join(root, "settings.json"), JSON.stringify({ powerline: { welcome: false } }));
  const { default: powerline } = await import("../index.ts");
  const handlers = new Map();
  const coordinationHandlers = new Map<string, Set<(data: unknown) => void>>();
  const emittedCoordinationEvents: Array<{ channel: string; data: unknown }> = [];
  const events = {
    on(channel: string, handler: (data: unknown) => void) {
      const listeners = coordinationHandlers.get(channel) ?? new Set();
      listeners.add(handler);
      coordinationHandlers.set(channel, listeners);
      return () => listeners.delete(handler);
    },
    emit(channel: string, data: unknown) {
      emittedCoordinationEvents.push({ channel, data });
      for (const handler of coordinationHandlers.get(channel) ?? []) handler(data);
    },
  };
  const sends: string[] = [];
  let idle = false;
  const ctx = {
    cwd: root, hasUI: false, isIdle: () => idle,
    sessionManager: { getSessionId: () => "readiness", getBranch: () => [] },
    ui: { notify() {}, setWorkingMessage() {}, setWidget() {}, setHeader() {} },
  };
  const emit = async (name, event = {}) => { await handlers.get(name)?.(event, ctx); };
  powerline({
    on: (name, handler) => handlers.set(name, handler), registerCommand() {}, events,
    sendUserMessage(text, options) {
      assert.equal(idle, true, "never send while busy");
      assert.equal(options, undefined, "never leave a late Pi follow-up");
      sends.push(text);
      void emit("before_agent_start", { prompt: text });
      idle = false;
    },
  });
  await emit("session_start", { reason: "new" });
  const store = new PowerlineQueueStore();
  const item = store.add({ text: "after retry", intent: "post-compact", source: { cwd: root, sessionId: "readiness" }, target: { kind: "current-session" } });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(async () => {
    await emit("session_shutdown", { reason: "quit" });
    t.mock.timers.reset();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  return { ctx, emit, events, emittedCoordinationEvents, store, item, sends, setIdle: () => { idle = true; }, tick: async () => { t.mock.timers.tick(1000); await setImmediate(); } };
}

test("successful retry keeps readiness through busy settlement without inbox I/O", async (t) => {
  const h = await readinessHarness(t);
  const second = h.store.add({ ...h.item, text: "last queued prompt", now: h.item.createdAt + 1 });
  await h.emit("session_before_compact");
  await h.emit("session_compact", { willRetry: true });
  // Reject filesystem access, rather than counting private queue/cache calls.
  const read = fs.readFileSync;
  const stat = fs.statSync;
  const rejectInbox = (original) => (path, ...args) => {
    assert.ok(!String(path).endsWith("inbox.jsonl"), "busy readiness must not inspect the inbox");
    return original(path, ...args);
  };
  const readMock = t.mock.method(fs, "readFileSync", rejectInbox(read));
  const statMock = t.mock.method(fs, "statSync", rejectInbox(stat));
  syncBuiltinESMExports();
  try {
    await h.tick();
    await h.emit("agent_settled");
    await h.tick();
    assert.deepEqual(h.sends, []);
  } finally {
    readMock.mock.restore(); statMock.mock.restore(); syncBuiltinESMExports();
  }
  assert.equal(h.store.get(h.item.id)?.status, "queued");
  h.setIdle();
  await h.tick();
  await h.tick();
  assert.deepEqual(h.sends, ["after retry"]);
  assert.equal(h.store.get(h.item.id)?.status, "sent");
  assert.equal(h.store.get(second.id)?.status, "queued");
  h.setIdle();
  await h.tick();
  assert.deepEqual(h.sends, ["after retry", "last queued prompt"]);
  assert.equal(h.store.get(second.id)?.status, "sent");
  t.mock.method(h.ctx, "isIdle", () => assert.fail("no readiness polling after the last queued item"));
  await h.emit("agent_settled");
  await h.tick();
});

test("Powerline holds delivery until matching continuation release", async (t) => {
  const h = await readinessHarness(t);
  await h.emit("session_before_compact");
  h.events.emit("pi-handoff-compaction:v1", {
    version: 1, kind: "hold", sessionId: "readiness", orchestrationId: "handoff-1",
  });
  assert.deepEqual(h.emittedCoordinationEvents.at(-1), {
    channel: "pi-handoff-compaction:v1",
    data: { version: 1, kind: "acknowledged", sessionId: "readiness", orchestrationId: "handoff-1" },
  });
  await h.emit("session_compact_failed", { aborted: true });
  await h.emit("session_compact", { willRetry: false });
  h.setIdle();
  await h.tick();
  assert.deepEqual(h.sends, []);
  assert.equal(h.store.get(h.item.id)?.status, "queued");

  h.events.emit("pi-handoff-compaction:v1", {
    version: 1, kind: "release", sessionId: "other-session", orchestrationId: "handoff-1",
  });
  await h.tick();
  assert.deepEqual(h.sends, []);

  h.events.emit("pi-handoff-compaction:v1", {
    version: 1, kind: "release", sessionId: "readiness", orchestrationId: "handoff-1",
  });
  await h.tick();
  assert.deepEqual(h.sends, ["after retry"]);
  assert.equal(h.store.get(h.item.id)?.status, "sent");

  h.events.emit("pi-handoff-compaction:v1", {
    version: 1, kind: "hold", sessionId: "readiness", orchestrationId: "handoff-1",
  });
  assert.equal(
    h.emittedCoordinationEvents.filter((event) => (
      event.channel === "pi-handoff-compaction:v1"
      && typeof event.data === "object" && event.data !== null
      && "kind" in event.data && event.data.kind === "acknowledged"
    )).length,
    1,
  );
});

test("matching handoff failure blocks queued items without delivery", async (t) => {
  const h = await readinessHarness(t);
  h.events.emit("pi-handoff-compaction:v1", {
    version: 1, kind: "hold", sessionId: "readiness", orchestrationId: "handoff-1",
  });
  await h.emit("session_compact_failed", { aborted: false, errorMessage: "Compaction cancelled" });
  assert.equal(h.store.get(h.item.id)?.status, "queued");
  h.events.emit("pi-handoff-compaction:v1", {
    version: 1, kind: "failure", sessionId: "other-session", orchestrationId: "handoff-1", reason: "wrong session",
  });
  assert.equal(h.store.get(h.item.id)?.status, "queued");
  h.events.emit("pi-handoff-compaction:v1", {
    version: 1, kind: "failure", sessionId: "readiness", orchestrationId: "handoff-1", reason: "handoff failed",
  });
  assert.equal(h.store.get(h.item.id)?.status, "blocked");
  assert.equal(h.store.get(h.item.id)?.error, "handoff failed");
  assert.deepEqual(h.sends, []);
});

test("new compaction cancellation and session replacement retire pending readiness", async (t) => {
  const h = await readinessHarness(t);
  await h.emit("session_before_compact");
  await h.emit("session_compact", { willRetry: false });
  await h.emit("session_before_compact");
  await h.emit("session_compact_failed", { aborted: true });
  await h.emit("session_compact_failed", { aborted: true });
  h.setIdle();
  await h.tick();
  assert.deepEqual(h.sends, []);
  assert.equal(h.store.get(h.item.id)?.status, "blocked");
  h.store.update(h.item.id, { status: "queued" });
  await h.emit("session_compact", { willRetry: false });
  await h.emit("session_shutdown", { reason: "reload" });
  await h.emit("session_start", { reason: "reload" });
  await h.emit("agent_settled");
  await h.tick();
  assert.deepEqual(h.sends, []);
  assert.equal(h.store.get(h.item.id)?.status, "queued");
});

test("reload -> editor /compact -> captured prompt starts after delayed manual completion without agent_settled", { skip: !sdkPath, timeout: 10000 }, async (t) => {
  const sdk = await import(pathToFileURL(sdkPath!).href);
  const { KeybindingsManager } = await import(codingAgentModuleUrl("core/keybindings.js"));
  const root = mkdtempSync(join(tmpdir(), "powerline-compaction-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  writeFileSync(join(root, "settings.json"), JSON.stringify({ powerline: { welcome: false }, compaction: { enabled: false, keepRecentTokens: 1 } }));
  const { default: powerline } = await import("../index.ts");
  const before = deferred();
  const summarize = deferred();
  const dispatched = deferred();
  const finishDispatch = deferred();
  const completed = deferred();
  const starts: string[] = [];
  const notifications: Array<{ message: string; type?: string }> = [];
  let settlements = 0;
  let editor;
  let emitHandoffEvent: ((kind: "hold" | "release") => void) | undefined;
  let sessionId = "";
  const settingsManager = sdk.SettingsManager.create(root, root);
  const loader = new sdk.DefaultResourceLoader({
    cwd: root, agentDir: root, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [powerline, (pi) => {
      emitHandoffEvent = (kind) => pi.events?.emit("pi-handoff-compaction:v1", {
        version: 1, kind, sessionId, orchestrationId: "handoff-1",
      });
      pi.on("session_before_compact", async (event) => {
        before.resolve();
        await summarize.promise;
        return { compaction: { summary: "Summary", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: 100 } };
      });
      pi.on("session_compact", async () => {
        dispatched.resolve();
        await finishDispatch.promise;
      });
      pi.on("before_agent_start", (event) => { starts.push(event.prompt); });
      pi.on("agent_settled", () => { settlements++; });
    }],
  });
  let session;
  try {
    await loader.reload();
    const manager = sdk.SessionManager.inMemory(root);
    sessionId = manager.getSessionId();
    manager.appendMessage({ role: "user", content: "Earlier request", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Earlier answer" }], api: "openai-completions", provider: "test", model: "test", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
    manager.appendMessage({ role: "user", content: "Latest request", timestamp: Date.now() });
    const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null });
    await modelRuntime.setRuntimeApiKey("openai", "test-key");
    const model = modelRuntime.getModels("openai")[0];
    assert.ok(model, "runtime has built-in OpenAI model");
    ({ session } = await sdk.createAgentSession({ cwd: root, agentDir: root, settingsManager, resourceLoader: loader, sessionManager: manager, modelRuntime, model, tools: [] }));
    // No provider requests: compaction comes from the supported custom-summary hook;
    // delivery is acknowledged at before_agent_start, before this local stream error.
    session.agent.streamFunction = () => { throw new Error("probe: no network"); };
    const tui = { requestRender() {}, terminal: { columns: 80, rows: 24 }, setFocus() {}, hasOverlay: () => false };
    const theme = { borderColor: (s) => s, selectList: { selectedPrefix: (s) => s, selectedText: (s) => s, description: (s) => s, scrollInfo: (s) => s, noMatch: (s) => s } };
    const ui = new Proxy({
      theme: { fg: (_color, s) => s, bg: (_color, s) => s, bold: (s) => s },
      setEditorComponent(factory) { if (factory) editor = factory(tui, theme, KeybindingsManager.create(root)); },
      getEditorComponent: () => undefined,
      onTerminalInput: () => () => {},
      setStatus() {}, notify(message, type) { notifications.push({ message, type }); t.diagnostic(message); }, setWorkingMessage() {}, setWidget() {}, setFooter() {}, setHeader() {},
      custom: async () => undefined, select: async () => undefined,
    }, { get: (target, key) => key in target ? target[key] : () => {} });
    await session.bindExtensions({ uiContext: ui, onError: (error) => { throw new Error(JSON.stringify(error)); } });
    await session.reload();
    assert.ok(editor, "reload installs the real Powerline editor");
    session.subscribe((event) => { if (event.type === "compaction_end") completed.resolve(); });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    editor.setText("/compact");
    editor.handleInput("\r");
    await before.promise;
    assert.ok(emitHandoffEvent, "handoff event publisher is installed");
    emitHandoffEvent("hold");
    editor.setText("run after manual compaction");
    editor.handleInput("\r");
    const store = new PowerlineQueueStore(join(root, "powerline-footer", "inbox.jsonl"), join(root, "powerline-footer", "projects.json"));
    const context = { cwd: root, sessionId: manager.getSessionId() };
    assert.equal(store.queuedDeliveryItems(context, "post-compact").length, 1);
    editor.setText("/model");
    editor.handleInput("\r");
    assert.equal(editor.getExpandedText(), "/model", "held slash commands stay in the editor");
    assert.equal(store.queuedDeliveryItems(context, "post-compact").length, 1, "held slash commands are not queued");
    assert.deepEqual(notifications.at(-1), {
      message: "Handoff compaction is in progress. Wait for the continuation prompt to finish.",
      type: "error",
    });
    editor.setText("/new");
    editor.handleInput("\r");
    assert.equal(editor.getExpandedText(), "", "held session commands pass through to Pi");
    editor.setText("");
    summarize.resolve();
    await dispatched.promise;
    t.diagnostic(`during dispatch: idle=${session.isIdle}, queued=${store.queuedDeliveryItems(context, "post-compact").length}, pending=${session.pendingMessageCount}`);
    // 0.84.4 reports manual dispatch idle; 0.85.0 includes compaction in isIdle.
    const busyDispatch = !session.isIdle;
    // Preserve the older-runtime held-dispatch failure as an explicit probe mode.
    // Normal 0.84.4 success releases dispatch before the delivery timer runs.
    if (busyDispatch || process.env.PI_COMPACTION_HOLD_IDLE_DISPATCH === "1") {
      t.mock.timers.tick(1000);
      if (busyDispatch) assert.deepEqual(starts, [], "must not enqueue into busy manual dispatch");
      else await setImmediate();
    }
    assert.equal(session.pendingMessageCount, 0);
    finishDispatch.resolve();
    await completed.promise;
    assert.equal(session.isIdle, true);
    if (busyDispatch) assert.equal(settlements, 0, "manual completion provides no agent_settled wakeup");
    t.mock.timers.tick(1000);
    await setImmediate();
    assert.deepEqual(starts, [], "held queue must wait for continuation release");
    emitHandoffEvent("release");
    t.mock.timers.tick(1000);
    await setImmediate();
    t.diagnostic(`after completion: idle=${session.isIdle}, status=${store.list()[0]?.status}, pending=${session.pendingMessageCount}, starts=${starts.length}, settlements=${settlements}`);
    assert.deepEqual(starts, ["run after manual compaction"], "must start without another user action or watchdog");
    assert.equal(store.list().find((item) => item.text === "run after manual compaction")?.status, "sent");
    assert.equal(session.pendingMessageCount, 0);
    t.mock.timers.tick(1000);
    await setImmediate();
    assert.deepEqual(starts, ["run after manual compaction"], "readiness must retire after acknowledgement");
  } finally {
    summarize.resolve();
    finishDispatch.resolve();
    if (session) {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    }
    t.mock.timers.reset();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
  }
});

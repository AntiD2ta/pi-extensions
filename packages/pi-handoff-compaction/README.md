# pi-handoff-compaction

`pi-handoff-compaction` owns handoff compaction when it is loaded. It works without `pi-powerline-footer` in TUI, RPC, JSON, and print modes.

## What happens

A manual `/compact` request or an automatic trigger starts a handoff compaction:

1. The extension cancels the first compaction request.
2. It asks the current agent to write a handoff document to one generated path under the operating system temporary directory.
3. It verifies that the active `write` tool wrote a non-empty regular Markdown file with every required section.
4. Pi compacts the session and starts with `Read and follow <handoff-path>`.

The operating system owns temporary-file cleanup. The extension does not delete a handoff document because the continuing agent may still need it.

A handoff compaction needs an active `write` tool. If `write` is unavailable or inactive, the extension leaves the conversation uncompacted and reports the failure. It also fails without retrying if the provider context has already overflowed before the handoff can begin. One response can move a session from below the trigger to provider overflow, so the extension cannot guarantee recovery in that case.

Automatic handoff begins at the earliest of Pi's native compaction threshold, 90 percent of the active model context window, or 275,000 used tokens.

## Manual focus and Powerline

Without Powerline, `/compact <text>` adds `<text>` as handoff focus. With Powerline configured to queue compact prompts, Powerline keeps that text as a queued post-compaction instruction instead.

Powerline remains the queue owner. When both packages are loaded, it acknowledges the handoff, holds submitted input during orchestration, waits for the continuation prompt, then releases queued prompts in FIFO order. Handoff compaction still works when Powerline is not loaded.

## Edit the handoff instruction

[`handoff-instruction.md`](handoff-instruction.md) is the editable fixed instruction sent to the agent. It contains the required Markdown headings and no runtime placeholders.

At runtime, the extension appends the generated handoff path, the initial prompt, and optional `/compact` focus in a separate `<handoff-runtime>` section. Edit the Markdown file for instruction changes. Do not add runtime values to it or change TypeScript interpolation for ordinary prompt edits.

## Load it without Powerline

Package filters select resources from this monorepo independently:

```json
{
  "packages": [
    {
      "source": "git:github.com/AntiD2ta/pi-extensions@v0.1.0",
      "extensions": ["packages/pi-handoff-compaction/index.ts"]
    }
  ]
}
```

Add `packages/pi-powerline-footer/index.ts` to load both. Use an empty `extensions` array to load neither.

## Terminology

This package is the **compaction owner**. The temporary Markdown file is the **handoff document**, and the first message after compaction is the **continuation prompt**. ADR-0006, Plane item PI-54, assigns compaction ownership separately from Powerline queue ownership. [`CONTEXT.md`](../../CONTEXT.md) defines these terms.

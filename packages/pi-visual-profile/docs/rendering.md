# Rendering contract

## Renderer order

Pi chooses a tool renderer in this order:

1. An explicit third-party or MCP renderer.
2. The active visual profile.
3. Pi's built-in renderer.
4. Pi's generic fallback.

An explicit renderer stays in control, except where the compact style replaces it (see below). The profile frames eligible built-in cards but does not replace self-rendered tools. `pi-tool-display` remains authoritative for `edit` and `write` when it is enabled, except under the compact style. The profile supplies its semantic edit card only when that renderer is absent or disabled.

## What the profile changes

The bundled dark and light themes color user messages, tool state, Markdown, syntax, diffs, selectors, dialogs, notifications, and native chat text without replacing their structure. The profile can add code-fence headers and closing lines. A header names a path or language when there is enough width. It leaves highlighted code unchanged and omits labels instead of wrapping on narrow terminals.

Tool cards have `boxed`, `minimal`, and `compact` styles. Boxed cards preserve native call and result content inside a state-colored frame. Minimal cards preserve the same content without a frame. Cards keep native image rows and expand through Pi's normal control.

## Compact cards

Compact cards replace a tool's renderer through `pi.registerToolRenderer`, which needs Pi 1.1. Each row has one header line, the last three output lines, and a count of hidden lines:

```text
• Ran git log --oneline · 420ms
  └ 70c0362 feat: ...
    41169ba fix: ...
    + 37 lines (ctrl+o)
```

`bash`, `powershell`, `read`, `grep`, `find`, `ls`, `edit`, `write`, `codemode`, `web_search`, `fetch_content`, `get_search_content`, and the built-in MCP tools (`mcp__<server>__<tool>`) use compact cards by default, even when another extension such as `pi-tool-display` draws them. An MCP header reads `• Called linear/list_issues {"query":"bug"}`. The header uses Pi's real server and tool names once the result arrives. pi-mcp-adapter's `mcp__<server>` proxy tools keep the adapter's presentation. Adapter tool names with a second `__`, such as a proxy for a server named `a--b`, also match. Any other tool uses a compact card only when it has no renderer of its own. `/visual-profile renderer <tool> compact|owner` overrides either default. Rows already on screen switch renderers only on Pi builds with the profile hook (`activateToolRendererProfile`); on public Pi 1.1, a change applies to new rows.

Each kind of tool has its own verb color: shell, file, search, edit, web, MCP, codemode, and other tools. A failed call shows its verb in the error color. Headers highlight their targets in bold: the command, paths, search patterns, queries, and URLs. Colors come from the active theme. A shell header shows the first line of the command, the exit code of a failed command, and the duration. A codemode header totals its calls, the cost and tokens of its `models.*` calls, and the duration, then lists every nested call. Expanding a codemode card shows codemode's own rendering in Pi's tool box. Per-call tokens need a Pi build that reports them.

Compact `edit` and `write` cards show a header such as `• Edited notes.ts (+2 -1)` or `• Added notes.ts (+4 -0)` above the owner's diff or code body, on the tool's success or error background. The owner's own summary row is dropped. The owner's pending preview is not shown while the call runs.

The semantic edit card names the file, counts additions and removals, marks hunk ranges, colors added and removed rows, and limits a collapsed preview. `side-by-side` uses paired replacement rows when the terminal is wide enough. It falls back to stacked rows below that width.

## Compatibility

The package checks for public APIs at runtime. It does not monkeypatch Pi internals or fingerprint components. If Pi does not provide a profile hook, that UI area keeps Pi's native rendering. Non-TUI modes keep native rendering. `/visual-profile doctor` reports each capability.

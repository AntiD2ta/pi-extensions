# Rendering contract

## Renderer order

Pi chooses a tool renderer in this order:

1. An explicit third-party or MCP renderer.
2. The active visual profile.
3. Pi's built-in renderer.
4. Pi's generic fallback.

An explicit renderer stays in control. The profile frames eligible built-in cards but does not replace self-rendered tools. `pi-tool-display` remains authoritative for `edit` and `write` when it is enabled. The profile supplies its semantic edit card only when that renderer is absent or disabled.

## What the profile changes

The bundled dark and light themes color user messages, tool state, Markdown, syntax, diffs, selectors, dialogs, notifications, and native chat text without replacing their structure. The profile can add code-fence headers and closing lines. A header names a path or language when there is enough width. It leaves highlighted code unchanged and omits labels instead of wrapping on narrow terminals.

Tool cards have `boxed` and `minimal` styles. Boxed cards preserve native call and result content inside a state-colored frame. Minimal cards preserve the same content without a frame. Cards keep native image rows and expand through Pi's normal control.

The semantic edit card names the file, counts additions and removals, marks hunk ranges, colors added and removed rows, and limits a collapsed preview. `side-by-side` uses paired replacement rows when the terminal is wide enough. It falls back to stacked rows below that width.

## Compatibility

The package checks for public APIs at runtime. It does not monkeypatch Pi internals or fingerprint components. If Pi does not provide a profile hook, that UI area keeps Pi's native rendering. Non-TUI modes keep native rendering. `/visual-profile doctor` reports each capability.

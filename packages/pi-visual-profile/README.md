# pi-visual-profile

Opt-in visual-profile extension shell for Pi. Its single package entry is
`packages/pi-visual-profile/index.ts`: profile commands, typed configuration,
tool-card framing, and themes.

The footer and the queue belong to `pi-powerline-footer`, which owns both surfaces under ADR-0005. This package never renders a footer and never stores queue state.

When enabled, the profile acquires boxed MCP presentation from the bundled adapter and frames Pi's native built-in tool cards without replacing their call or result renderers. The bundled themes are selectable through `/settings` whether the profile is enabled or not.

## Visual trial

Run this checkout from its root in a disposable Pi agent directory. This preserves your normal Pi configuration:

```bash
trial_home="$(mktemp -d)"
HOME="$trial_home" pi install "$PWD"
HOME="$trial_home" pi --use-theme pi-visual-profile-dark
```

The checkout includes the forked MCP adapter. In the disposable Pi session, use `/mcp setup` to create a test MCP configuration, then reload Pi before the visual check. The adapter retains its normal configuration discovery and setup flow.

At the Pi prompt, run these commands in order:

```text
/mcp setup
/reload
/visual-profile doctor
/visual-profile enable
/visual-profile cards boxed
/visual-profile cards minimal
/visual-profile glyph unicode
/visual-profile glyph ascii
/visual-profile glyph nerd-font
/visual-profile inherit
/visual-profile disable
```

For a trusted project override, start Pi in that project and run:

```text
/visual-profile enable --local
/visual-profile glyph ascii --local
/visual-profile doctor
```

## Sign-off checks

1. Select both `pi-visual-profile-dark` and `pi-visual-profile-light` through `/settings`; confirm readable text, borders, user blocks, tool states, Markdown, and syntax colors.
2. Confirm `/visual-profile enable`, `disable`, and `glyph` leave the footer unchanged. With `pi-powerline-footer` installed, confirm its footer renders identically before and after profile commands. Without it, confirm Pi's native footer is unchanged.
3. Compare `/visual-profile cards boxed` with `/visual-profile cards minimal`. Both retain Pi's native tool content; boxed adds the state-coloured frame.
4. Confirm `/visual-profile doctor` reports the effective scope, configuration, theme availability, MCP presentation compatibility, and tool renderer profile capability.
5. Restart Pi with the same `trial_home`; confirm the selected profile, glyph settings, and card style persist.
6. Run one MCP call after setup. Confirm the adapter-owned card shows `MCP`, the server and operation, a textual status, bounded result text, and the configured border and glyph mode. Use Ctrl+O to compare collapsed and expanded output.
7. Disable the profile, then repeat the MCP call. Confirm native adapter rendering returns while `/mcp setup` and configuration discovery remain available.

## Offline smoke model

The checkout includes `tests/faux-provider.ts` for deterministic local smoke tests. Load it explicitly. It registers `pi-visual-profile-faux/scripted`, uses no network or credentials, and replies with scripted responses:

```bash
HOME="$(mktemp -d)" pi \
  -e "$PWD/packages/pi-visual-profile/index.ts" \
  -e "$PWD/packages/pi-visual-profile/tests/faux-provider.ts" \
  --provider pi-visual-profile-faux --model scripted
```

Remove the trial data when finished:

```bash
rm -rf "$trial_home"
```

# pi-visual-profile

Opt-in visual-profile and queue extension shells for Pi. They are independently selectable package entries:

- `packages/pi-visual-profile/index.ts`: profile commands, typed configuration, themes, and the visible footer prototype.
- `packages/pi-visual-profile/queue.ts`: independently loadable durable queue delivery. It owns the new queue store, delivery lifecycle, compaction capture, and native status. PI-37 adds queue management commands and picker UI.

## Visual trial

Run this checkout from its root in a disposable Pi agent directory. This preserves your normal Pi configuration:

```bash
trial_home="$(mktemp -d)"
HOME="$trial_home" pi install "$PWD"
HOME="$trial_home" pi --use-theme pi-visual-profile-dark
```

The checkout now includes the forked MCP adapter. In the disposable Pi session, use `/mcp setup` to create a test MCP configuration, then reload Pi before the visual check. The adapter retains its normal configuration discovery and setup flow.

At the Pi prompt, run these commands in order:

```text
/mcp setup
/reload
/visual-profile doctor
/visual-profile enable
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
2. After `/visual-profile enable`, confirm the compact footer shows the profile mode, glyph mode, and current Git branch.
3. Confirm `unicode`, `ascii`, and `nerd-font` repaint the footer immediately. In ASCII mode, the footer must contain only ASCII glyphs.
4. Confirm `/visual-profile disable` restores Pi's native footer.
5. Confirm `/visual-profile doctor` reports the effective scope, configuration, theme availability, capability support, and native degradation.
6. Restart Pi with the same `trial_home`; confirm the selected profile and glyph settings persist.
7. Run one MCP call after setup. Confirm the adapter-owned card shows `MCP`, the server and operation, a textual status, bounded result text, and the configured border and glyph mode. Use Ctrl+O to compare collapsed and expanded output.
8. Disable the profile, then repeat the MCP call. Confirm native adapter rendering returns while `/mcp setup` and configuration discovery remain available.
9. Start Pi with only `packages/pi-visual-profile/queue.ts` selected in `settings.json`; confirm `/visual-profile-queue` works while `/visual-profile` is unavailable.

Remove the trial data when finished:

```bash
rm -rf "$trial_home"
```

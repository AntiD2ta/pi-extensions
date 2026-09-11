# pi-visual-profile

Opt-in visual-profile extension shell for Pi. Its single package entry is
`packages/pi-visual-profile/index.ts`: profile commands, typed configuration, and themes.

The footer and the queue belong to `pi-powerline-footer`, which owns both surfaces under ADR-0005. This package never renders a footer and never stores queue state.

Enabling the profile currently only stores configuration. The surfaces it will style, tool cards, chat surfaces, and code-fence chrome, are not implemented yet, so `/visual-profile enable` changes nothing on screen. The bundled themes are selectable through `/settings` whether the profile is enabled or not.

## Visual trial

Run this checkout from its root in a disposable Pi agent directory. This preserves your normal Pi configuration:

```bash
trial_home="$(mktemp -d)"
HOME="$trial_home" pi install "$PWD"
HOME="$trial_home" pi --use-theme pi-visual-profile-dark
```

At the Pi prompt, run these commands in order:

```text
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
2. Confirm `/visual-profile enable`, `disable`, and `glyph` report the saved setting and leave the rendered UI unchanged, including the footer.
3. With `pi-powerline-footer` also installed, confirm its footer renders identically before and after `/visual-profile enable`. Without it, confirm Pi's native footer renders unchanged.
4. Confirm `/visual-profile doctor` reports the effective scope, configuration, theme availability, and that the profile claims no footer and has no visible surface yet.
5. Restart Pi with the same `trial_home`; confirm the selected profile and glyph settings persist.

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

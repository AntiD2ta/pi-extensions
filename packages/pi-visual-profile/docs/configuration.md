# Configuration

The profile stores global configuration in `~/.pi/agent/visual-profile/config.json`. A trusted project can override selected fields in `.pi/visual-profile/config.json`. Commands write global configuration by default. Add `--local` only in a trusted project.

| Command | Result |
| --- | --- |
| `/visual-profile enable` | Enable profile presentation. |
| `/visual-profile disable` | Release profile-owned overrides. |
| `/visual-profile glyph unicode\|nerd-font\|ascii` | Select code-fence and MCP glyph mode. |
| `/visual-profile cards boxed\|minimal` | Select built-in tool-card framing. |
| `/visual-profile diff stacked\|side-by-side` | Select mutation-card layout. |
| `/visual-profile doctor` | Show effective configuration and compatibility state. |

Add `--local` to any setting command to write the trusted project's override. Glyph, cards, diff layout, and enablement apply in the running TUI after the command.

The supported fields are `enabled`, `glyphMode`, `borderStyle`, `padding`, `toolCardStyle`, and `diffLayout`. `padding` accepts integers from 0 through 3. `borderStyle` controls code-fence chrome only. Pi has no public API for editor border glyphs.

The bundled themes are `pi-visual-profile-dark` and `pi-visual-profile-light`. Pi owns theme selection. Select either theme with `/settings` or `--use-theme`, whether the profile is enabled or not. Enabling or disabling the profile leaves Pi's selected theme unchanged.

There are no footer settings. There are no queue settings. Powerline owns both.

# Configuration

The profile stores global configuration in `~/.pi/agent/visual-profile/config.json`. A trusted project can override selected fields in `.pi/visual-profile/config.json`. Commands write global configuration by default. Add `--local` only in a trusted project.

| Command | Result |
| --- | --- |
| `/visual-profile enable` | Enable profile presentation. |
| `/visual-profile disable` | Release profile-owned overrides. |
| `/visual-profile inherit` | Keep the selected Pi theme instead of selecting a bundled profile theme. |
| `/visual-profile glyph unicode\|nerd-font\|ascii` | Select code-fence and MCP glyph mode. |
| `/visual-profile cards boxed\|minimal` | Select built-in tool-card framing. |
| `/visual-profile diff stacked\|side-by-side` | Select mutation-card layout. |
| `/visual-profile doctor` | Show effective configuration and compatibility state. |

Add `--local` to any setting command to write the trusted project's override. Glyph, cards, diff layout, enablement, and inheritance apply in the running TUI after the command.

The supported fields are `enabled`, `themeMode`, `glyphMode`, `borderStyle`, `padding`, `toolCardStyle`, and `diffLayout`. `padding` accepts integers from 0 through 3. `borderStyle` controls code-fence chrome only. Pi has no public API for editor border glyphs.

The bundled themes are `pi-visual-profile-dark` and `pi-visual-profile-light`. Select them with `/settings` whether the profile is enabled or not. When enabled in profile theme mode, the profile chooses the matching light or dark bundled theme. An explicit Pi `/theme` selection is preserved by `/visual-profile inherit`.

There are no footer settings. There are no queue settings. Powerline owns both.

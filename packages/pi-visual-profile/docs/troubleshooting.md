# Troubleshooting

Run `/visual-profile doctor` first. It reports effective scope, configuration paths, bundled theme availability, code-fence chrome, editor padding, theme override, MCP presentation, and renderer-profile support.

| Doctor output | Meaning and action |
| --- | --- |
| `footer: never claimed` | Expected. Powerline or Pi owns the footer. |
| `unsupported surfaces: native Pi rendering` | The installed Pi version lacks a public hook. Native rendering is the fallback. |
| `tool renderer profile: unavailable` | Upgrade to a compatible Pi build, or use native tool cards. |
| `MCP presentation: owned by ...` | Another extension owns boxed MCP presentation. Keep that owner or release it there. |
| `adapter unavailable` | Install or enable the bundled MCP adapter before expecting boxed MCP cards. |
| `project overrides global` | A trusted project configuration changes one or more global values. |

If `--local` fails, trust the project first. If a bundled theme is unavailable, reload the package and confirm its theme entry was not excluded by a package filter. If a change is not visible, check that the session runs in TUI mode.

Do not delete Powerline settings or queue data to troubleshoot profile presentation. They are separate packages.

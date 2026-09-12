# Release verification

Use [Installation](installation.md) to prepare a disposable Pi home. Then complete this check list:

1. Install `pi-visual-profile` alone and confirm `/visual-profile doctor`, both themes, enablement, glyph modes, code-fence chrome, native chat presentation, tool cards, and mutation-card layouts.
2. Install `pi-powerline-footer` alone and confirm its footer and queue work without profile files.
3. Install both through independent package filters. Enable and disable the profile. Confirm Powerline's footer remains unchanged and its queue data remains untouched.
4. Run one MCP call after adapter setup. Confirm its explicit renderer remains authoritative and the profile affects it only through the adapter's presentation protocol.
5. Run the repository documentation test, typecheck, and test suites.

The human acceptance gate is a maintainer completing one installation path and one authoring path using only [the index](INDEX.md). Record the result before release work continues.

Follow-ups from PI-23 and PI-40 remain out of this release: structural special-message rendering, selector structure hooks, syntax highlighting inside diff rows, and profile-aware HTML export.

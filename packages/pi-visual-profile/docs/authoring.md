# Authoring with the profile

Use public Pi APIs. Feature-detect optional APIs and leave native behavior in place when they are absent. Do not monkeypatch Pi internals or identify components by shape.

The renderer order is documented in [Rendering](rendering.md). Register an explicit renderer only when the extension owns that tool's presentation. Otherwise let the active profile frame Pi's built-in renderer. The checked example in [`examples/authoring.ts`](../examples/authoring.ts) shows owner-scoped code-fence chrome that releases its own claim at shutdown.

Keep owner tokens private. Claim a UI area once, release the same token, and do not release another extension's claim. This allows Pi to restore the previous owner. Do not claim the footer or queue from a profile-aware extension. Powerline owns them.

For MCP presentation, use the adapter's explicit presentation protocol. If an MCP or third-party renderer already owns a tool, preserve it. For mutation tools, preserve `pi-tool-display` when it provides an explicit self renderer.

Test against an older compatible Pi version. Verify that missing optional hooks leave native output intact, then run `/visual-profile doctor` to confirm the reported capability state.

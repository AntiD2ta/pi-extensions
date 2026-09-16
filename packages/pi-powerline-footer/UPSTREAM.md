# Upstream provenance and sync procedure

This supported extension is a source copy from [`nicobailon/pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer) at commit [`fb48aa72`](https://github.com/nicobailon/pi-powerline-footer/commit/fb48aa72eb8b7c140d2b42ff05cbfb9e7b653e9b), the `v0.17.1` release. It does not retain the source repository's Git history. Checked 2026-09-13: the upstream default branch and latest tag both resolved to this revision.

The workspace previously copied the AntiD2ta fork at commit [`fe4d659173e6`](https://github.com/AntiD2ta/pi-powerline-footer/commit/fe4d659173e60a763a21a865dc96db6e2199ad41). [NOTICE](NOTICE) records both source revisions and contributor notice. [LICENSE](LICENSE) preserves the MIT terms, and `package.json` retains Nico Bailon as the original author.

## Local divergence

Keep this list current when a sync changes it.

- **Source behavior.** `index.ts` and `powerline-config.ts` retain additive welcome-header and editor-mouse compatibility. `git-status.ts` uses local command bounds. `quote-reply.ts` strips terminal controls. `shortcuts.ts`, its configuration, and tests use the local `Cmd+B` stash contract instead of retired sharp-S behavior.
- **PI-48 usage segment.** `usage-window.ts` is local. `index.ts`, `segments.ts`, `icons.ts`, `types.ts`, and `powerline-config.ts` add the opt-in `usage` segment. It feature-detects the fork-only `ModelRegistry.getUsageReport` method, fetches lazily, caches per provider for 60 seconds, deduplicates work, and bounds waits at two seconds. The expected sync conflict is its `index.ts` gate: retain `allSegmentIds.includes("usage")`. `tests/subscription-usage.test.ts` and `tests/faux-usage-smoke.ts` cover it. PI-41 owns replacing its local usage-report type after a fork release.
- **ADR-0005 coexistence.** The footer and queue ownership rule is a monorepo policy, not an upstream feature. Reconcile any upstream code that would claim either surface against that rule.
- **Monorepo integration.** `LICENSE`, `NOTICE`, this file, the package test setup, and local documentation are not copied upstream source. Keep them in this workspace. Do not copy upstream's lockfile or CI workflow.

## Sync procedure

1. Verify the recorded source and legal records:

   ```bash
   recorded_commit=fb48aa72eb8b7c140d2b42ff05cbfb9e7b653e9b
   recorded_tag=v0.17.1
   candidate_tag=$recorded_tag
   git ls-remote https://github.com/nicobailon/pi-powerline-footer.git HEAD "refs/tags/$recorded_tag"
   git ls-remote --tags --refs https://github.com/nicobailon/pi-powerline-footer.git
   ```

   Done when `HEAD` and `refs/tags/$recorded_tag` both equal `$recorded_commit`, the tag list has no newer release to consider, and [NOTICE](NOTICE) still names every copied revision.

2. Clone the candidate tag into a temporary directory and compare the source files:

   ```bash
   upstream=$(mktemp -d)
   git clone --depth 1 --branch "$candidate_tag" https://github.com/nicobailon/pi-powerline-footer.git "$upstream"
   diff -qr -x .git -x .github -x .gitignore -x package-lock.json \
     -x LICENSE -x NOTICE -x UPSTREAM.md -x README.md -x CHANGELOG.md -x package.json \
     -x setup.ts -x pi-modules.ts \
     -x faux-usage-smoke.ts -x subscription-usage.test.ts \
     "$upstream" packages/pi-powerline-footer
   ```

   Done when every reported source difference maps to one entry in **Local divergence** or is a candidate upstream change.

3. Apply the source update. Preserve the listed local contracts, including public-Pi feature detection and the `allSegmentIds.includes("usage")` gate. Stop for a maintainer decision if a conflict changes the supported Pi range, release line, or surface ownership. Done when the reconciled diff contains no unexplained difference.

4. Update this file and [NOTICE](NOTICE) with the copied commit and tag. Keep the original author and MIT license in `package.json`. Update peer ranges only with the root `@earendil-works/pi-*` devDependencies. Done when provenance, divergence, and package metadata agree.

5. Run:

   ```bash
   npm run typecheck
   npm test
   ```

   Done when both root commands pass, the comparison result is recorded, and the temporary clone is removed.

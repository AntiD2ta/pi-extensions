# Development rules

## Plane project

Work in this repo is tracked in the Plane project `PI` ("PI"), workspace slug `local`, base URL
`http://localhost`. The `repos:` marker in that project's description is the real repo-to-project
binding. This file mirrors it for offline lookup. Re-run `plane-bootstrap-project` to refresh it.

One project covers two repos, `github.com/antid2ta/pi` (the Pi core fork) and
`github.com/antid2ta/pi-extensions` (this monorepo), because most extension work depends on fork
changes. Read a work item before assuming which repo it targets.

Two things go wrong on Plane writes. The agent token has to be a project member, or member-scoped
writes fail. Plane also drops an assignee who is not a project member, and `update_work_item` reports
that in its response rather than failing.

Conventions: decisions are `adr` work items, issues are work items, the glossary is `CONTEXT.md` in
this repo, and wayfinder maps are `wayfinder:map` work items.

## Style

- Short answers, technical prose, no filler.
- No emojis in commits, issues, PR comments, or code.
- Answer the question before editing files or running commands.
- When you respond to feedback, say whether you agree before saying what you changed.

## Layout

- The root `package.json` holds the workspaces list and the Pi manifest that loads
  `packages/*/index.ts`. It is `private`. Releases go out as git tags.
- `packages/pi-powerline-footer` is a maintained fork of
  [`nicobailon/pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer), imported with
  its history. Its `UPSTREAM.md` records provenance and licensing.
- `test/` holds the root tests for package discovery and extension filtering.
- The extension API docs ship inside the dependency, under
  `node_modules/@earendil-works/pi-coding-agent/docs`. Start with `extensions.md`, `tui.md`,
  `settings.md`, `keybindings.md`, and the sibling `examples/extensions`. Read them instead of guessing
  an API.

## Commands

- `npm ci --ignore-scripts` for a clean install, `npm install --ignore-scripts` to hydrate. Skip
  lifecycle scripts unless the user asks for them.
- `npm run typecheck` covers the root and every workspace.
- `npm test` runs the root tests and every workspace. Run it before you commit code.
- One workspace test file, from the package root:
  `node --experimental-strip-types --import ./tests/setup.ts --test tests/<name>.test.ts`
- To try an extension in Pi, install the checkout with `pi install /absolute/path/to/pi-extensions`.

## Tests

- Tests must never read the real `~/.pi/agent`. `packages/pi-powerline-footer/tests/setup.ts` points
  `HOME` at an empty temp directory, and the package's `test` script loads it with `--import`. Keep
  both. Theme, icon, and settings lookups all go through `HOME`, so a real agent dir outranks the
  preset colors and icons a test passes in, and the test then fails on that machine only.
- Tests that need their own `HOME` set and restore it themselves. Do not swap that per-test isolation
  for one shared `PI_CODING_AGENT_DIR`. Extension state written to the agent dir survives into the next
  test in the file.
- Reach Pi internals through `packages/pi-powerline-footer/tests/pi-modules.ts`. Never symlink into
  `node_modules`, and never hardcode an install path. `pi-coding-agent` hides its dist layout behind
  `exports`, and its shrinkwrap can nest a second copy of `pi-tui`.
- Never skip a failing test, weaken its assertions, or stretch its timeout to make it pass. Find the
  cause, and tell environment leakage apart from a real bug.
- Assert behavior a user can observe, not private structure.
- No paid provider calls in tests. Use pi-ai's faux provider.

## Fork maintenance

- `pi-powerline-footer` stays MIT with its original author credited in `package.json`. Record every
  upstream import commit in `UPSTREAM.md`.
- Keep local changes small so the next upstream merge stays cheap.
- Feature-detect any Pi API that only the `AntiD2ta/pi` fork has, so the extension still runs on public
  Pi. The editor `handleMouse` wrapper in `index.ts` is the existing example.
- Peer dependency ranges say which Pi versions a package supports. Change them together with the root
  devDependencies, not on their own.

## Code quality

- Read a file in full before you edit it, and before any change that spans many files.
- Avoid `any`. Inline a one-line helper that has a single call site.
- Top-level imports only. No `await import()` or `import("pkg").Type`, except in a test that must
  import after changing the environment.
- Match the style of the file you edit. Leave adjacent code alone.
- Ask before deleting code that looks intentional.
- Never commit audio files or other third-party media.

## Git

- Commit only the files you changed in this session. Stage explicit paths with `git add <path>`, never
  `git add -A` or `git add .`. Check `git status` first.
- Message format: `{feat,fix,chore,docs}: <short message>`, with a body when it needs one.
- Never run `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, or
  `git commit --no-verify`. Never force push.
- Never commit unless the user asks.

## User override

If the user's instructions conflict with a rule here, ask for confirmation before overriding it. Then
do what they asked.

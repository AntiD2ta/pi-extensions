# Development rules

## Plane projects

Plane projects that track work for **this repo**. The `repos:` marker in each project description is authoritative; this list is its offline mirror. Re-run `plane-bootstrap-project` to refresh it.

- **Concern: PI** — project `PI` ("PI")
  - Workspace slug `local` · base URL `http://localhost`
  - Spans repos: `github.com/antid2ta/pi`, `github.com/antid2ta/pi-extensions`
  - Gotchas: the agent token must be a project member · Plane drops an assignee who is not a project member
  - Conventions: decisions = `adr` work items · issues = work items · glossary = `CONTEXT.md` · wayfinder maps = `wayfinder:map` work items

One project covers two repos, `github.com/antid2ta/pi` (the Pi core fork) and
`github.com/antid2ta/pi-extensions` (this monorepo), because most extension work depends on fork
changes. Read a work item before assuming which repo it targets.

Two things go wrong on Plane writes. The agent token has to be a project member, or member-scoped
writes fail. Plane also drops an assignee who is not a project member, and `update_work_item` reports
that in its response rather than failing.

Conventions: decisions are `adr` work items, issues are work items, the glossary is `CONTEXT.md` in
this repo, and wayfinder maps are `wayfinder:map` work items.

### Executing a Plane work item

When asked to "Pick PI-X":

  1. Fetch the work item from the PI project. Read its relationships and any linked PRD or ADR.
  2. For a bug investigation, load `/skill:diagnosing-bugs`.
  3. For code changes, load `/skill:dev-tdd`. Work in a new git worktree unless the current worktree already belongs to the task.
  4. Load `/skill:code-review` during the acceptance loop. Fix findings that need no spec or design decision. Use `/skill:grill-with-plane` to resolve decisions with the user. Track worthwhile follow-up work through `/skill:plane-to-issues`.
  5. For agent-facing documentation, load `/skill:writing-for-agents`. Apply `/skill:unslop` to other documentation.
  6. Commit and push under the Git rules below. Use `/skill:show-me` for the PR body. Prefer `/skill:gh-stack` when related work items form independently reviewable vertical slices.
  7. Before reporting task completion, add a work item comment summarizing completed work, relevant findings or learning, blockers, and the resulting work item state.

## Style

- Short answers, technical prose, no filler.
- No emojis in commits, issues, PR comments, or code.
- Answer the question before editing files or running commands.
- When you respond to feedback, say whether you agree before saying what you changed.

## Layout

- The root `package.json` holds the workspaces list and the Pi manifest that loads
  `packages/*/index.ts`. It is `private`. Releases go out as git tags.
- `packages/pi-powerline-footer` is a maintained source copy of
  [`nicobailon/pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer), without its
  Git history. Its `UPSTREAM.md`, `NOTICE`, and `LICENSE` record provenance and licensing.
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
  upstream source revision in `UPSTREAM.md` and `NOTICE`.
- Keep local changes small so the next upstream sync stays cheap.
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

For the commit message:
  - Include key decisions made
  - Include files changed
  - Blockers or notes for next iteration

If the git operations you are making involves git conflicts, load and use the /skill:resolving-merge-conflicts skill.

## User override

If the user's instructions conflict with a rule here, ask for confirmation before overriding it. Then
do what they asked.

## Visual validation and smoke tests

For visual TUI work, leave implementation uncommitted until a human signs off.

Use Herdr only when `HERDR_ENV=1`. Create validation tabs with
`herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" --label "<task>" --no-focus`.
Never steal the user's focus.

Use a two-agent trial:
1. Start a writable Sol coordinator in the first background tab.
2. Sol creates a second background Herdr tab for a Luna smoke-test agent.
3. Luna runs the local Pi build and leaves its interactive TUI visible.
4. Sol drives Luna with repeatable smoke-test prompts and steering. The human inspects Luna's tab.
5. Keep both agents and tabs open until the human signs off. Do not commit, push, or create a PR first.

When a model call is needed, add a test-only faux-provider extension under the affected package's `tests/` support files. It must:
- import `fauxProvider()` from `@earendil-works/pi-ai`;
- register it programmatically through Pi's extension API;
- use scripted responses that exercise the exact built-in tools and states under review;
- use no network, credentials, or paid provider;
- remain outside production package entries and runtime behavior.

Build the local core checkout with `npm ci --ignore-scripts` and `npm run build`. Link only the local `pi-ai`, `pi-tui`, and `pi-coding-agent` workspaces for development. Verify resolved paths. Do not commit path dependencies, lockfile changes, peer-range changes, build outputs, or trial data.

Record exact trial commands, generated artifacts, resolved package paths, test results, visual sign-off status, and
cleanup commands in the work item handoff.
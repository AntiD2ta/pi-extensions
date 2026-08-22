# Development Rules

## Plane projects

Plane projects that track work for **this repo**. Before any Plane write, pick the project whose
**Concern** matches the task at hand — never guess; if unsure, ask. The `repos:` marker in each
project's Plane description is the authoritative repo↔project binding; this list mirrors it for offline
lookup and is refreshed by re-running `plane-bootstrap-project`.

- **Concern: PI** — project `PI` ("PI")
  - Workspace slug `local` · base URL `http://localhost`
  - Spans repos: `github.com/antid2ta/pi`, `github.com/antid2ta/pi-extensions`
  - The same project tracks the Pi core fork and this extensions monorepo, because most extension
    work depends on fork changes. Read a slice before assuming which repo it belongs to.
  - Gotchas: the agent token must be a *project member* — the server surfaces a legible error on
    member-scoped writes otherwise · an assignee is **silently dropped** if they are not a project member
    (`update_work_item`'s response warns when this happens)
  - Conventions: decisions = `adr` work items · issues = work items · glossary = `CONTEXT.md` (repo) ·
    wayfinder maps = `wayfinder:map` work items

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- Technical prose only, be direct
- Answer the user's question before making edits or running implementation commands
- When responding to feedback or an analysis, say whether you agree or disagree before saying what you changed

## Layout

- Root: npm workspaces manifest plus the Pi manifest (`pi.extensions`) that loads `packages/*/index.ts`.
  Distribution is git tags only; the root package is `private`.
- `packages/pi-powerline-footer`: maintained fork of
  [`nicobailon/pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer), imported with
  its history. Provenance and licensing live in its `UPSTREAM.md`.
- `test/`: root package-discovery and filtering tests.
- Extension API docs ship with the dependency: `node_modules/@earendil-works/pi-coding-agent/docs`
  (`extensions.md`, `tui.md`, `settings.md`, `keybindings.md`) and `.../examples/extensions`. Read them
  instead of guessing an API.

## Commands

- Install: `npm ci --ignore-scripts` (clean) or `npm install --ignore-scripts` (hydrate). Do not run
  lifecycle scripts unless the user asks.
- `npm run typecheck` type-checks the root and every workspace.
- `npm test` runs the root tests and every workspace's tests. Run it before committing code changes.
- One workspace file, from the package root:
  `node --experimental-strip-types --import ./tests/setup.ts --test tests/<name>.test.ts`
- Interactive checks use a local-path install: `pi install /absolute/path/to/pi-extensions`.

## Tests

- Tests must not read the developer's real `~/.pi/agent`. `packages/pi-powerline-footer/tests/setup.ts`
  points `HOME` at an empty temp directory and is loaded through `--import` in the package's `test`
  script; keep both. Theme, icon, and settings lookups resolve through `HOME`, so a real agent dir
  otherwise overrides preset colors and icons and makes tests fail only on that machine.
- Tests that need their own `HOME` still set and restore it themselves. Do not replace that per-test
  isolation with a shared `PI_CODING_AGENT_DIR`: extension state written to the agent dir then leaks
  between tests in the same file.
- Reach Pi internals through `packages/pi-powerline-footer/tests/pi-modules.ts`, never by symlinking
  into `node_modules` or hardcoding an install path. `pi-coding-agent` hides its dist layout behind
  `exports`, and it ships a shrinkwrap that can nest its own `pi-tui` copy.
- Never skip, weaken, or retime a failing test to make it pass. Find the cause first, and separate
  environment leakage from a real bug.
- Assert externally visible behavior rather than private structure.
- Extensions must not call paid providers in tests; use pi-ai's faux provider.

## Fork Maintenance

- Keep `pi-powerline-footer` MIT-licensed with its original author credited in `package.json`, and record
  every upstream import commit in `UPSTREAM.md`.
- Keep local changes small and focused so upstream merges stay cheap.
- Pi APIs that exist only on the `AntiD2ta/pi` fork must be feature-detected, so extensions keep working
  on public Pi. Existing example: the editor `handleMouse` wrapper in `index.ts`.
- Peer dependency ranges bound the Pi versions a package supports; update them deliberately with the
  root devDependencies.

## Code Quality

- Read files in full before wide-ranging changes and before editing files you have not inspected.
- No `any` unless unavoidable. Inline single-line helpers that have only one call site.
- No inline imports (`await import()` for types, `import("pkg").Type`). Top-level imports only, except
  where a test must import after mutating the environment.
- Match the existing style of the file you edit; do not reformat or "improve" adjacent code.
- Ask before removing functionality or code that appears intentional.
- Do not commit audio assets or other third-party media.

## Git

- Only commit files you changed in this session. Stage explicit paths (`git add <path>`), never
  `git add -A` or `git add .`. Run `git status` before committing.
- Message format: `{feat,fix,chore,docs}: <concise message>`, optionally with a body.
- Never run `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, or
  `git commit --no-verify`. Never force push.
- Never commit unless the user asks.

## User Override

If the user's instructions conflict with any rule here, ask for explicit confirmation before overriding.
Only then execute their instructions.

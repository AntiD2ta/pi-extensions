# Installation

Install the monorepo package with Pi's normal package workflow. Use a tag for repeatable installs.

```bash
pi install git:github.com/AntiD2ta/pi-extensions@<tag>
```

A package source normally loads every declared extension. To load only one, filter its extension entry in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/AntiD2ta/pi-extensions@<tag>",
      "extensions": ["packages/pi-visual-profile/index.ts"]
    }
  ]
}
```

Use `packages/pi-powerline-footer/index.ts` instead to load only Powerline. List both paths to combine them. The two paths load independently. Neither package reads the other's settings, storage, or private state.

For a disposable local checkout trial:

```bash
trial_home="$(mktemp -d)"
HOME="$trial_home" pi install "$PWD"
HOME="$trial_home" pi --use-theme pi-visual-profile-dark
```

Run `/reload` after changing package selection or extension files. Project-local settings and resources require project trust. Remove a trial when finished:

```bash
rm -rf "$trial_home"
```

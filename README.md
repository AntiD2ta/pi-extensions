# Pi Extensions

Personal [Pi](https://pi.dev) extensions distributed as one Git-based npm-workspaces package. Install a tagged release to load every maintained extension by default. Git installation clones the whole repository; package filters control only which resources Pi loads.

## Installation

Install a tagged release globally:

```bash
pi install git:github.com/AntiD2ta/pi-extensions@v0.1.0
```

Install it for one trusted project:

```bash
pi install -l git:github.com/AntiD2ta/pi-extensions@v0.1.0
```

Use a local checkout during development:

```bash
pi install /absolute/path/to/pi-extensions
```

## Loading selected extensions

Use a package entry in `~/.pi/agent/settings.json` or `.pi/settings.json` to select specific resources:

```json
{
  "packages": [
    {
      "source": "git:github.com/AntiD2ta/pi-extensions@v0.1.0",
      "extensions": ["packages/pi-powerline-footer/index.ts"]
    }
  ]
}
```

Use `"extensions": []` to load no extensions from the package. Omitting `extensions` loads every extension declared by the root manifest.

## Packages

- [`pi-powerline-footer`](packages/pi-powerline-footer/README.md): a Powerline-style Pi status bar.

## Development

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
```

The Powerline workspace was imported from [AntiD2ta/pi-powerline-footer](https://github.com/AntiD2ta/pi-powerline-footer) at commit [`fe4d659173e6`](https://github.com/AntiD2ta/pi-powerline-footer/commit/fe4d659173e60a763a21a865dc96db6e2199ad41). Its standalone repository remains active.

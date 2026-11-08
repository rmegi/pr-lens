# PR Lens

A desktop app for reviewing pull requests locally. Pick a repository, compare a branch against `develop` (or any base), read the changes side by side in VS Code's diff editor, and get an AI review: a summary, whether it is a feature or a fix and why, risks, and concrete recommendations that link straight to the line.

Runs on **macOS and Linux** (Windows works too). Built with Electron, React, TypeScript, Tailwind CSS and Monaco.

## Features

- **PR-accurate diff**: compares the branch against its merge-base with the base branch (`git diff base...branch`), so changes that landed on `develop` afterwards don't show up.
- **Side-by-side or inline** Monaco diff with syntax highlighting, collapsed unchanged regions, ignore-whitespace and word wrap.
- File list with added/modified/deleted/renamed badges and line counts, a file filter, and the commit list.
- Searchable branch pickers (local and remote), a swap button, and `git fetch --all --prune`.
- **AI review panel** that streams Markdown. `path:line` references are clickable and open the diff at that line.
  - **Claude Code CLI** provider: uses your existing `claude` login, and can read surrounding code with read-only tools (Read/Grep/Glob).
  - **Anthropic API** provider: uses an API key (stored encrypted with the OS keychain via Electron `safeStorage`) or `ANTHROPIC_API_KEY`.
  - Optional team review guidelines are added to every review.

## Keyboard

| Key | Action |
|---|---|
| `j` / `k` | next / previous file |
| `]` / `[` | next / previous change |
| `⌘/Ctrl + Enter` | run AI review |
| `⌘/Ctrl + ,` | settings |

## Develop

Requires Node 20+ and git.

```bash
npm install
npm run dev
```

If npm skipped Electron's download (npm 11 can block install scripts), run `node node_modules/electron/install.js` once.

## Build installers

```bash
npm run build:mac     # .dmg + .zip
npm run build:linux   # .AppImage + .deb
npm run build:win     # .exe (NSIS)
```

Output goes to `dist/`. Builds are unsigned. On macOS, right-click → Open the first time, or add signing config to `electron-builder.yml`.

## AI setup

- **Claude Code CLI** (default): install Claude Code and log in once in a terminal (`claude`, then `/login`). PR Lens finds `claude` in `~/.local/bin`, Homebrew and npm global paths, even when it is launched from the Dock or a desktop launcher.
- **Anthropic API**: Settings → Anthropic API → paste a key. The default model is `claude-opus-5-5`, and you can change it in Settings.

Diffs over ~400 KB ask for confirmation before they are sent.

## Project layout

```
src/main/         Electron main process: git, settings, AI providers, IPC
src/preload/      contextBridge API exposed as window.api
src/shared/       types shared by main and renderer
src/renderer/     React + Tailwind UI (Monaco diff, sidebar, review panel)
```

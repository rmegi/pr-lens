# PR Lens for VS Code

Compare Git branches, inspect individual commits in VS Code's native diff editor, and discuss the changes with AI. Browsing is read-only: it never checks out a branch, changes working files, fetches, or pushes.

## Use

1. Open a local Git repository in VS Code and click the **PR Lens** icon in the Activity Bar.
2. Click **Base** or **Compare** to choose branches.
3. Use **History** to switch the commit list independently of the comparison. Feature branches show commits ahead of the base; main, master, develop, dev, and the base branch show their history.
4. Click a commit to show its changes against its first parent. Merge commits use their first parent; root commits show all files as additions. The commit list stays visible.
5. Click a changed file to open its native diff, or **Back to branch comparison** to return.

History loads in pages of 100. **Refresh** reloads local refs and returns to the branch comparison. Binary files and files over 5 MB show an explanatory message instead of a text diff. A shallow clone needs the selected commit's parent available locally.

Git must be on PATH. The extension requires a trusted, filesystem-backed workspace; remote workspace execution is configured but has not been tested on SSH, WSL, or containers.

## AI review and chat

Click **AI review / chat** in the sidebar, or run **PR Lens: Open AI Chat**. Click **Review changes** for a review of the selected branch comparison or commit, then ask follow-up questions. Replies stream as Markdown; `path:line` references to changed files open the historical diff. **Stop** cancels a request, and **New chat** clears the conversation. Changing the selected comparison starts a new conversation. Chat history stays in memory for this VS Code window.

- **Claude Code CLI** is the default. Install `claude` and log in on the machine containing the repository. If login expires, run `claude` in a terminal and use `/login`. Reviews use the desktop app's existing read-only CLI provider.
- **Anthropic API:** use the **API key** button or **PR Lens: Set Anthropic API Key**. The key is stored in VS Code secret storage. In Settings, select `anthropic-api` for `prLens.ai.provider` and enter the model ID in `prLens.ai.model`. The existing provider also supports its environment-based credentials.
- `prLens.ai.instructions` adds team review guidelines. Leave the model blank for the Claude CLI default.

Requests send the selected diff and conversation to the configured provider only when you click Review or Send. Requests over 400 KB ask for confirmation. Provider usage may incur charges. The Claude CLI can read surrounding files; the API provider receives only the supplied context.

## Install locally

Use **Extensions: Install from VSIX…** and select `dist/pr-lens-vscode-0.2.0.vsix`, or run from the repository root:

```bash
code --install-extension dist/pr-lens-vscode-0.2.0.vsix
```

## Develop and test

Requires Node 22.6+, Git, and VS Code. From the repository root:

```bash
npm ci
npm ci --prefix vscode
npm --prefix vscode run typecheck
npm --prefix vscode test
npm --prefix vscode run package
```

Tests use the installed `code` executable and a temporary VS Code profile and Git repository. Set `VSCODE_EXECUTABLE` if your executable has another name. Test repositories are deleted after the run. Packaging creates a local VSIX; it does not publish to the Marketplace.

The extension bundles the desktop app's existing Git and AI provider implementations, so fixes and validation are shared. No Electron or React runtime is included. AI integration tests use a fake CLI and a local streaming API server; they never call paid AI services.

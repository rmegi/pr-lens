import * as vscode from 'vscode'
import { compare, compareCommit, filePair, listBranches, listCommits, resolveCommit, resolveRepo } from '../../src/main/git'
import type { ChangedFile, Commit, Comparison, RepoInfo } from '../../src/shared/types'
import { diffUri, HistoricalDocuments } from './documents'
import { AiChat } from './chat'
import { fixPath } from '../../src/main/env'

type Item = vscode.TreeItem & { children?: Item[] }
interface FileTarget { repo: string; comparison: Comparison; file: ChangedFile; title: string; line?: number }

function row(label: string, id: string, command?: string, args: unknown[] = []): Item {
  const item: Item = new vscode.TreeItem(label)
  item.id = id
  if (command) item.command = { command, title: label, arguments: args }
  return item
}

class PrLens implements vscode.TreeDataProvider<Item>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event
  readonly view: vscode.TreeView<Item>
  readonly chat: AiChat
  info?: RepoInfo
  base = ''
  head = ''
  historyBranch = ''
  comparison?: Comparison
  commit?: Commit
  commits: Commit[] = []
  hasMore = false
  error = ''
  private historyTip = ''
  private historyBase?: string
  private comparisonRequest = 0
  private historyRequest = 0
  private repositoryRequest = 0
  private loadingHistory = false

  constructor(private readonly context: vscode.ExtensionContext) {
    this.view = vscode.window.createTreeView('prLens.history', { treeDataProvider: this, showCollapseAll: true })
    this.chat = new AiChat(context, async (target, path, line) => {
      const file = target.comparison.files.find((f) => f.path === path)
      if (file) await this.openDiff({ ...target, file, title: `${path} (${target.label})`, line })
    })
    context.subscriptions.push(this.chat)
    const command = <Args extends unknown[]>(id: string, action: (...args: Args) => Promise<unknown>) => {
      context.subscriptions.push(vscode.commands.registerCommand(`prLens.${id}`, async (...args: Args) => {
        try {
          this.error = ''
          return await action(...args)
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e)
          this.view.message = this.error
          void vscode.window.showErrorMessage(`PR Lens: ${this.error}`)
        }
      }))
    }
    command('openRepository', (uri?: vscode.Uri) => this.openRepository(uri))
    command('selectBase', (branch?: string) => this.selectBranch('base', branch))
    command('selectHead', (branch?: string) => this.selectBranch('head', branch))
    command('selectHistory', (branch?: string) => this.selectBranch('historyBranch', branch))
    command('refresh', () => this.refresh())
    command('loadMore', () => this.loadHistory(false))
    command('showCommit', (hash: string) => this.loadComparison(hash))
    command('showBranchComparison', () => this.loadComparison())
    command('openDiff', (target: FileTarget) => this.openDiff(target))
    command('openChat', async () => this.chat.show())
    command('reviewChanges', () => this.chat.send('Review these changes.', true))
    command('setApiKey', () => this.chat.setApiKey())
  }

  async initialize() {
    const saved = this.context.workspaceState.get<string>('prLens.repository')
    const candidates = [saved, ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)].filter(Boolean) as string[]
    for (const candidate of candidates) {
      try {
        await resolveRepo(candidate)
      } catch { continue } // A workspace may not contain Git.
      await vscode.commands.executeCommand('prLens.openRepository', vscode.Uri.file(candidate))
      return
    }
  }

  async openRepository(uri?: vscode.Uri) {
    if (!uri) {
      const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, title: 'Open a Git repository' })
      uri = selected?.[0]
    }
    if (!uri) return
    const request = ++this.repositoryRequest
    const repo = await resolveRepo(uri.fsPath)
    const info = await listBranches(repo)
    if (request !== this.repositoryRequest) return
    this.info = info
    this.base = info.defaultBase
    this.head = info.current && info.current !== 'HEAD' ? info.current : info.branches[0]?.name ?? ''
    this.historyBranch = this.head
    await this.context.workspaceState.update('prLens.repository', repo)
    await vscode.commands.executeCommand('setContext', 'prLens.hasRepository', true)
    await Promise.all([this.loadComparison(), this.loadHistory(true)])
  }

  async refresh() {
    if (!this.info) return this.openRepository()
    const info = await listBranches(this.info.repo)
    if (info.repo !== this.info?.repo) return
    this.info = info
    const names = new Set(info.branches.map((b) => b.name))
    if (!names.has(this.base)) this.base = info.defaultBase
    if (!names.has(this.head)) this.head = names.has(info.current) ? info.current : this.base
    if (!names.has(this.historyBranch)) this.historyBranch = this.head
    await Promise.all([this.loadComparison(), this.loadHistory(true)])
  }

  async selectBranch(target: 'base' | 'head' | 'historyBranch', branch?: string) {
    if (!this.info) await this.openRepository()
    const info = this.info
    if (!info) return
    if (branch === undefined) {
      const choice = await vscode.window.showQuickPick(info.branches.map((b) => ({
        label: b.name, description: `${b.remote ? 'remote · ' : ''}${b.date}`
      })), { title: `PR Lens: ${target === 'base' ? 'Base branch' : target === 'head' ? 'Compare branch' : 'History branch'}`, placeHolder: 'Choose a branch', matchOnDescription: true })
      branch = choice?.label
    }
    if (!branch || this.info !== info) return
    if (!info.branches.some((b) => b.name === branch)) throw new Error(`Branch not found: ${branch}`)
    this[target] = branch
    if (target === 'head') this.historyBranch = branch
    await Promise.all([this.loadComparison(), this.loadHistory(true)])
  }

  async loadComparison(hash?: string) {
    if (hash && this.commit?.hash === hash) return
    const request = ++this.comparisonRequest
    const info = this.info
    this.comparison = undefined
    this.commit = undefined
    this.chat.setTarget(undefined)
    this.view.message = 'Loading changes…'
    this.changed.fire()
    if (!info || !this.base || !this.head) {
      this.view.message = 'No commits yet. Commit a file in Git, then refresh.'
      return
    }
    let comparison: Comparison
    if (hash) comparison = await compareCommit(info.repo, hash, false)
    else {
      const [base, head] = await Promise.all([resolveCommit(info.repo, this.base), resolveCommit(info.repo, this.head)])
      comparison = await compare(info.repo, base, head, false)
    }
    if (request !== this.comparisonRequest || info !== this.info) return
    this.comparison = comparison
    this.commit = hash ? comparison.commits[0] : undefined
    this.view.description = info.name
    this.view.message = this.commit
      ? `${this.commit.hash.slice(0, 7)} · ${this.commit.subject} · ${comparison.base === 'Empty tree' ? 'first commit' : 'vs first parent'}`
      : `${this.head} → ${this.base}`
    this.chat.setTarget({ repo: info.repo, comparison, commit: this.commit?.hash, label: this.view.message })
    this.changed.fire()
    if (hash && comparison.files.length) {
      const file = comparison.files.find((f) => !f.binary)
      if (file) await this.openDiff(this.fileTarget(file))
    }
  }

  async loadHistory(reset: boolean) {
    if (!reset && (!this.hasMore || this.loadingHistory)) return
    const request = ++this.historyRequest
    const info = this.info
    const branch = this.historyBranch
    if (reset) {
      this.commits = []
      this.hasMore = false
    }
    if (!info || !branch) { this.loadingHistory = false; this.changed.fire(); return }
    this.loadingHistory = true
    this.changed.fire()
    try {
      if (reset) {
        const remote = info.branches.find((b) => b.name === branch)?.remote
        const name = remote ? branch.slice(branch.indexOf('/') + 1) : branch
        const fullHistory = branch === this.base || ['main', 'master', 'develop', 'dev'].includes(name)
        const [tip, base] = await Promise.all([
          resolveCommit(info.repo, branch),
          fullHistory || !this.base ? undefined : resolveCommit(info.repo, this.base)
        ])
        if (request !== this.historyRequest || info !== this.info) return
        this.historyTip = tip
        this.historyBase = base
      }
      const page = await listCommits(info.repo, this.historyTip, this.commits.length, this.historyBase)
      if (request !== this.historyRequest || info !== this.info) return
      this.commits.push(...page)
      this.hasMore = page.length === 100
    } finally {
      if (request === this.historyRequest) {
        this.loadingHistory = false
        this.changed.fire()
      }
    }
  }

  private fileTarget(file: ChangedFile): FileTarget {
    return {
      repo: this.info!.repo, comparison: this.comparison!, file,
      title: `${file.path} (${this.commit ? this.commit.hash.slice(0, 7) : `${this.head} vs ${this.base}`})`
    }
  }

  async openDiff(target: FileTarget) {
    const { repo, comparison, file } = target
    const pair = await filePair(repo, comparison.mergeBase, comparison.head, file)
    if (pair.binary || pair.tooLarge) {
      void vscode.window.showInformationMessage(pair.binary ? 'PR Lens: binary file, no text diff available.' : 'PR Lens: file exceeds the 5 MB preview limit.')
      return
    }
    await vscode.commands.executeCommand('vscode.diff',
      diffUri(repo, comparison, file, 'original'), diffUri(repo, comparison, file, 'modified'),
      target.title, { preview: true, preserveFocus: true, viewColumn: vscode.ViewColumn.One })
    if (target.line) {
      const uri = diffUri(repo, comparison, file, file.status === 'D' ? 'original' : 'modified').toString()
      const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri)
      if (editor) {
        const line = Math.max(0, Math.min(target.line - 1, editor.document.lineCount - 1))
        editor.selection = new vscode.Selection(line, 0, line, 0)
        editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter)
      }
    }
  }

  getTreeItem(item: Item): vscode.TreeItem { return item }

  getChildren(item?: Item): Item[] {
    if (item) return item.children ?? []
    if (!this.info) return []
    const controls = [
      row(`Repository: ${this.info.name}`, 'repo', 'prLens.openRepository'),
      row(`Base: ${this.base || 'none'}`, 'base', 'prLens.selectBase'),
      row(`Compare: ${this.head || 'none'}`, 'head', 'prLens.selectHead'),
      row(`History: ${this.historyBranch || 'none'}`, 'history', 'prLens.selectHistory'),
      row('AI review / chat', 'chat', 'prLens.openChat')
    ]
    if (this.commit) controls.push(row('Back to branch comparison', 'back', 'prLens.showBranchComparison'))
    const files = row(`Changed files (${this.comparison?.files.length ?? 0})`, 'files')
    files.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
    files.children = this.comparison?.files.map((file) => {
      const item = row(file.path, `file:${file.path}`, 'prLens.openDiff', [this.fileTarget(file)])
      item.description = `${file.status} · ${file.binary ? 'binary' : `+${file.additions} −${file.deletions}`}`
      item.tooltip = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path
      item.iconPath = new vscode.ThemeIcon(file.status === 'A' ? 'diff-added' : file.status === 'D' ? 'diff-removed' : file.status === 'R' ? 'diff-renamed' : 'diff-modified')
      return item
    }) ?? []
    if (!files.children.length) files.children.push(row(this.comparison?.merged ? 'No branch changes to review' : 'No changed files', 'no-files'))
    const commits = row(`Commits (${this.commits.length}${this.hasMore ? '+' : ''})`, 'commits')
    commits.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
    commits.description = this.historyBase ? `ahead of ${this.base}` : this.historyBranch
    commits.children = this.commits.map((commit) => {
      const item = row(commit.subject, `commit:${commit.hash}`, 'prLens.showCommit', [commit.hash])
      item.description = `${commit.hash.slice(0, 7)} · ${commit.author} · ${commit.date}`
      item.tooltip = `${commit.subject}\n${commit.hash}\n${commit.author} · ${commit.date}`
      item.iconPath = new vscode.ThemeIcon(commit.hash === this.commit?.hash ? 'check' : 'git-commit')
      return item
    })
    if (this.loadingHistory) commits.children.push(row('Loading history…', 'loading'))
    else if (this.hasMore) commits.children.push(row('Load older commits…', 'more', 'prLens.loadMore'))
    else if (!this.commits.length) commits.children.push(row(this.historyBase ? `No commits ahead of ${this.base}` : 'No commits', 'no-commits'))
    return [...controls, commits, files]
  }

  dispose() {
    this.repositoryRequest++
    this.comparisonRequest++
    this.historyRequest++
    this.changed.dispose()
    this.view.dispose()
  }
}

export async function activate(context: vscode.ExtensionContext) {
  fixPath()
  const lens = new PrLens(context)
  context.subscriptions.push(lens, vscode.workspace.registerTextDocumentContentProvider('pr-lens', new HistoricalDocuments()))
  await lens.initialize()
  return lens
}

export interface Branch {
  name: string
  date: string
  remote: boolean
}

export interface RepoInfo {
  repo: string
  name: string
  current: string
  defaultBase: string
  branches: Branch[]
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'

export interface ChangedFile {
  path: string
  oldPath?: string
  status: FileStatus
  additions: number | null
  deletions: number | null
  binary: boolean
}

export interface Commit {
  hash: string
  author: string
  date: string
  subject: string
}

/** Set when the compare branch has no changes because it is already in the base branch. */
export interface MergedInfo {
  /** Both refs point at the same commit. */
  sameCommit?: boolean
  /** The merge commit on the base branch that brought the compare branch in (short hash). */
  mergeCommit?: string
  mergeSubject?: string
  /** The base branch just before that merge; comparing against it shows what the branch changed. */
  beforeMerge?: string
}

export interface Comparison {
  base: string
  head: string
  mergeBase: string
  files: ChangedFile[]
  commits: Commit[]
  merged?: MergedInfo
}

export interface FilePair {
  original: string
  modified: string
  binary: boolean
  tooLarge: boolean
}

export type Provider = 'claude-cli' | 'anthropic-api'

export interface Settings {
  provider: Provider
  model: string
  reviewInstructions: string
  hasApiKey: boolean
  theme: 'system' | 'dark' | 'light'
  recentRepos: string[]
}

export interface SettingsUpdate {
  provider?: Provider
  model?: string
  reviewInstructions?: string
  apiKey?: string | null
  theme?: Settings['theme']
}

export interface ReviewRequest {
  id: string
  repo: string
  base: string
  head: string
  commit?: string
  /** set after the user confirmed sending a large diff */
  force?: boolean
}

/** What the user can do about a review error; the panel shows matching steps. */
export type ErrorFix = 'cli-login' | 'cli-missing' | 'api-key'

export type ReviewEvent =
  | { id: string; type: 'status'; text: string }
  | { id: string; type: 'delta'; text: string }
  | { id: string; type: 'replace'; text: string }
  | { id: string; type: 'done'; note?: string }
  | { id: string; type: 'error'; message: string; fix?: ErrorFix }
  | { id: string; type: 'confirm-large'; bytes: number }

export interface PrLensApi {
  pickRepo(): Promise<string | null>
  openRepo(path: string): Promise<RepoInfo>
  fetch(repo: string): Promise<RepoInfo>
  compare(repo: string, base: string, head: string, ignoreWhitespace: boolean): Promise<Comparison>
  listCommits(repo: string, head: string, skip: number, base?: string): Promise<Commit[]>
  compareCommit(repo: string, commit: string, ignoreWhitespace: boolean): Promise<Comparison>
  filePair(repo: string, mergeBase: string, head: string, file: ChangedFile): Promise<FilePair>
  getSettings(): Promise<Settings>
  saveSettings(update: SettingsUpdate): Promise<Settings>
  startReview(req: ReviewRequest): Promise<void>
  cancelReview(id: string): Promise<void>
  onReviewEvent(cb: (e: ReviewEvent) => void): () => void
  claudeCliAvailable(): Promise<boolean>
}

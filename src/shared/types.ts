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

export interface Comparison {
  base: string
  head: string
  mergeBase: string
  files: ChangedFile[]
  commits: Commit[]
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
  /** set after the user confirmed sending a large diff */
  force?: boolean
}

export type ReviewEvent =
  | { id: string; type: 'status'; text: string }
  | { id: string; type: 'delta'; text: string }
  | { id: string; type: 'replace'; text: string }
  | { id: string; type: 'done'; note?: string }
  | { id: string; type: 'error'; message: string }
  | { id: string; type: 'confirm-large'; bytes: number }

export interface PrLensApi {
  pickRepo(): Promise<string | null>
  openRepo(path: string): Promise<RepoInfo>
  fetch(repo: string): Promise<RepoInfo>
  compare(repo: string, base: string, head: string, ignoreWhitespace: boolean): Promise<Comparison>
  filePair(repo: string, mergeBase: string, head: string, file: ChangedFile): Promise<FilePair>
  getSettings(): Promise<Settings>
  saveSettings(update: SettingsUpdate): Promise<Settings>
  startReview(req: ReviewRequest): Promise<void>
  cancelReview(id: string): Promise<void>
  onReviewEvent(cb: (e: ReviewEvent) => void): () => void
  claudeCliAvailable(): Promise<boolean>
}

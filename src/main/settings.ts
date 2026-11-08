import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Settings, SettingsUpdate } from '@shared/types'

interface Stored {
  provider: Settings['provider']
  model: string
  reviewInstructions: string
  theme: Settings['theme']
  recentRepos: string[]
  /** base64; encrypted with safeStorage when available */
  apiKey?: string
  apiKeyEncrypted?: boolean
}

const DEFAULTS: Stored = {
  provider: 'claude-cli',
  model: 'claude-opus-5-5',
  reviewInstructions: '',
  theme: 'system',
  recentRepos: []
}

const file = () => path.join(app.getPath('userData'), 'settings.json')

let cache: Stored | null = null

function load(): Stored {
  if (cache) return cache
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache!
}

function persist(s: Stored) {
  cache = s
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(s, null, 2), { mode: 0o600 })
}

export function getStoredApiKey(): string | undefined {
  const s = load()
  if (!s.apiKey) return undefined
  const buf = Buffer.from(s.apiKey, 'base64')
  try {
    return s.apiKeyEncrypted ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch {
    return undefined
  }
}

export function getSettings(): Settings {
  const s = load()
  return {
    provider: s.provider,
    model: s.model,
    reviewInstructions: s.reviewInstructions,
    theme: s.theme,
    recentRepos: s.recentRepos,
    hasApiKey: Boolean(s.apiKey) || Boolean(process.env.ANTHROPIC_API_KEY)
  }
}

export function saveSettings(u: SettingsUpdate): Settings {
  const s = { ...load() }
  if (u.provider) s.provider = u.provider
  if (u.model !== undefined) s.model = u.model.trim() || DEFAULTS.model
  if (u.reviewInstructions !== undefined) s.reviewInstructions = u.reviewInstructions
  if (u.theme) s.theme = u.theme
  if (u.apiKey === null || u.apiKey === '') {
    delete s.apiKey
    delete s.apiKeyEncrypted
  } else if (u.apiKey) {
    const enc = safeStorage.isEncryptionAvailable()
    s.apiKey = (enc ? safeStorage.encryptString(u.apiKey) : Buffer.from(u.apiKey, 'utf8')).toString('base64')
    s.apiKeyEncrypted = enc
  }
  persist(s)
  return getSettings()
}

export function addRecentRepo(repo: string) {
  const s = { ...load() }
  s.recentRepos = [repo, ...s.recentRepos.filter((r) => r !== repo)].slice(0, 10)
  persist(s)
}

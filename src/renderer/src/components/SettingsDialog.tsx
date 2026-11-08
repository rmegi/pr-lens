import { useEffect, useState } from 'react'
import type { Provider, Settings, SettingsUpdate } from '@shared/types'
import { IconX } from '../lib/icons'

interface Props {
  settings: Settings
  onSave: (u: SettingsUpdate) => Promise<void>
  onClose: () => void
}

export default function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [provider, setProvider] = useState<Provider>(settings.provider)
  const [model, setModel] = useState(settings.model)
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [instructions, setInstructions] = useState(settings.reviewInstructions)
  const [theme, setTheme] = useState(settings.theme)
  const [cliFound, setCliFound] = useState<boolean | null>(null)

  useEffect(() => {
    window.api.claudeCliAvailable().then(setCliFound)
  }, [])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const save = async () => {
    await onSave({
      provider,
      model,
      reviewInstructions: instructions,
      theme,
      apiKey: clearKey ? null : apiKey || undefined
    })
    onClose()
  }

  const field = 'w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 outline-none focus:border-accent dark:border-zinc-700 dark:bg-zinc-900'

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[92vw] rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#12151c]"
      >
        <div className="flex items-center border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-[14px] font-semibold">Settings</h2>
          <button onClick={onClose} className="ml-auto text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            <IconX />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4">
          <div>
            <div className="mb-2 font-medium">AI provider</div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['claude-cli', 'Claude Code CLI', 'Uses your Claude Code login. Can read the repo for context.'],
                  ['anthropic-api', 'Anthropic API', 'Uses an API key. Streams the review directly.']
                ] as const
              ).map(([id, title, desc]) => (
                <button
                  key={id}
                  onClick={() => setProvider(id)}
                  className={`rounded-lg border p-3 text-left ${
                    provider === id ? 'border-accent bg-accent-soft' : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800'
                  }`}
                >
                  <div className="font-medium">{title}</div>
                  <div className="mt-1 text-[12px] text-zinc-500">{desc}</div>
                  {id === 'claude-cli' && cliFound !== null && (
                    <div className={`mt-1.5 text-[11px] ${cliFound ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {cliFound ? '● claude found' : '● claude not found on PATH'}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <div className="mb-1 font-medium">Model</div>
            <input value={model} onChange={(e) => setModel(e.target.value)} className={`${field} font-mono`} />
            <div className="mt-1 text-[11px] text-zinc-500">
              e.g. claude-opus-5-5 (default), claude-sonnet-5-5, claude-haiku-5-5
            </div>
          </label>

          {provider === 'anthropic-api' && (
            <label className="block">
              <div className="mb-1 font-medium">Anthropic API key</div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setClearKey(false)
                }}
                placeholder={settings.hasApiKey ? '•••••••• (saved, or from ANTHROPIC_API_KEY)' : 'sk-ant-…'}
                className={`${field} font-mono`}
              />
              <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-500">
                <span>Stored encrypted with your OS keychain when available.</span>
                {settings.hasApiKey && (
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /> Remove saved key
                  </label>
                )}
              </div>
            </label>
          )}

          <label className="block">
            <div className="mb-1 font-medium">Extra review guidelines</div>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={5}
              placeholder={'e.g.\n- We use React Query for all data fetching\n- Every API change needs a migration note\n- Flag any missing i18n strings'}
              className={`${field} resize-y`}
            />
          </label>

          <label className="block">
            <div className="mb-1 font-medium">Theme</div>
            <select value={theme} onChange={(e) => setTheme(e.target.value as Settings['theme'])} className={field}>
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button onClick={onClose} className="h-8 rounded-md px-3 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Cancel
          </button>
          <button onClick={save} className="h-8 rounded-md bg-accent px-4 font-medium text-white hover:brightness-110">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

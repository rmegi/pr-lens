import { useCallback, useEffect, useRef, useState } from 'react'
import type { Commit, Comparison, RepoInfo, Settings, SettingsUpdate } from '@shared/types'
import BranchPicker from './components/BranchPicker'
import Sidebar from './components/Sidebar'
import DiffView, { type ViewOptions } from './components/DiffView'
import ReviewPanel from './components/ReviewPanel'
import SettingsDialog from './components/SettingsDialog'
import { IconFolder, IconGear, IconPanel, IconRefresh, IconSparkle, IconSwap } from './lib/icons'
import type { monaco } from './lib/monaco'

const isMac = navigator.userAgent.includes('Mac')

function cleanError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function usePersisted<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key)
      return s ? { ...initial, ...JSON.parse(s) } : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* storage unavailable */
    }
  }, [key, v])
  return [v, setV] as const
}

function useDark() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const [dark, setDark] = useState(mq.matches)
  useEffect(() => {
    const f = () => setDark(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [mq])
  return dark
}

function Splitter({ onDrag }: { onDrag: (dx: number) => void }) {
  return (
    <div
      className="w-1 shrink-0 cursor-col-resize hover:bg-accent/40 active:bg-accent/60"
      onMouseDown={(e) => {
        let x = e.clientX
        const move = (ev: MouseEvent) => {
          onDrag(ev.clientX - x)
          x = ev.clientX
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          document.body.style.cursor = ''
        }
        document.body.style.cursor = 'col-resize'
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
    />
  )
}

export default function App() {
  const dark = useDark()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [info, setInfo] = useState<RepoInfo | null>(null)
  const [base, setBase] = useState('')
  const [head, setHead] = useState('')
  const [cmp, setCmp] = useState<Comparison | null>(null)
  const [commit, setCommit] = useState<Commit | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [jump, setJump] = useState<{ path: string; line: number; nonce: number } | null>(null)
  const [runSignal, setRunSignal] = useState(0)
  const [view, setView] = usePersisted<ViewOptions>('prlens.view', {
    sideBySide: true,
    ignoreWhitespace: false,
    hideUnchanged: true,
    wordWrap: false
  })
  const [layout, setLayout] = usePersisted('prlens.layout', { sidebar: 290, review: 420, reviewOpen: true })
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)

  const openRepo = useCallback(async (p: string) => {
    setError(null)
    try {
      const ri = await window.api.openRepo(p)
      setInfo(ri)
      setCommit(null)
      setCmp(null)
      setHistoryVersion((n) => n + 1)
      const b = ri.defaultBase
      const other = ri.branches.find((x) => x.name !== b && !x.remote)?.name ?? ri.branches.find((x) => x.name !== b)?.name ?? b
      setBase(b)
      setHead(ri.current && ri.current !== b && ri.current !== 'HEAD' ? ri.current : other)
      setSelected(null)
      setSettings(await window.api.getSettings())
    } catch (e) {
      setError(cleanError(e))
    }
  }, [])

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s)
      if (s.recentRepos[0]) openRepo(s.recentRepos[0])
    })
  }, [openRepo])

  // Recompute the comparison when branches, selected commit, or whitespace mode change.
  useEffect(() => {
    if (!info || (!commit && (!base || !head))) {
      setCmp(null)
      return
    }
    let stale = false
    setLoading(true)
    setError(null)
    setCmp(null)
    setJump(null)
    const comparison = commit
      ? window.api.compareCommit(info.repo, commit.hash, view.ignoreWhitespace)
      : window.api.compare(info.repo, base, head, view.ignoreWhitespace)
    comparison
      .then((c) => {
        if (stale) return
        setCmp(c)
        setSelected((s) => (s && c.files.some((f) => f.path === s) ? s : c.files[0]?.path ?? null))
      })
      .catch((e) => {
        if (stale) return
        setCmp(null)
        setError(cleanError(e))
      })
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
  }, [info, base, head, commit, view.ignoreWhitespace])

  const files = cmp?.files ?? []
  const file = files.find((f) => f.path === selected) ?? null

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        setLayout((l) => ({ ...l, reviewOpen: true }))
        setRunSignal((n) => n + 1)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
        return
      }
      const t = e.target
      const typing = t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]')
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'j' || e.key === 'k') {
        const i = files.findIndex((f) => f.path === selected)
        const next = files[Math.max(0, Math.min(files.length - 1, i + (e.key === 'j' ? 1 : -1)))]
        if (next) setSelected(next.path)
      } else if (e.key === ']') editorRef.current?.goToDiff('next')
      else if (e.key === '[') editorRef.current?.goToDiff('previous')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [files, selected, setLayout])

  const pickRepo = async () => {
    const p = await window.api.pickRepo()
    if (p) openRepo(p)
  }

  const doFetch = async () => {
    if (!info) return
    setFetching(true)
    try {
      setInfo(await window.api.fetch(info.repo))
      setHistoryVersion((n) => n + 1)
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setFetching(false)
    }
  }

  const saveSettings = async (u: SettingsUpdate) => setSettings(await window.api.saveSettings(u))

  const changeBase = (value: string) => {
    setCommit(null)
    setBase(value)
  }
  const changeHead = (value: string) => {
    setCommit(null)
    setHead(value)
  }

  const onJump = (path: string, line: number) => {
    setSelected(path)
    setJump({ path, line, nonce: Date.now() })
  }

  const btn =
    'flex h-7 items-center gap-1.5 rounded-md px-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800'

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header
        className={`drag flex h-11 shrink-0 items-center gap-2 border-b border-zinc-200 pr-3 dark:border-zinc-800/80 ${
          isMac ? 'pl-[84px]' : 'pl-3'
        }`}
      >
        <span className="mr-1 flex items-center gap-1.5 font-semibold tracking-tight">
          <IconSparkle width={15} height={15} className="text-accent" /> PR Lens
        </span>
        <button className={btn} onClick={pickRepo} title="Open repository">
          <IconFolder width={15} height={15} />
          <span className="max-w-[180px] truncate">{info?.name ?? 'Open repository'}</span>
        </button>
        {info && (
          <>
            <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
            <BranchPicker label="base" value={base} branches={info.branches} onChange={changeBase} />
            <button
              className={btn}
              title="Swap base and compare"
              onClick={() => {
                setCommit(null)
                setBase(head)
                setHead(base)
              }}
            >
              <IconSwap width={14} height={14} />
            </button>
            <BranchPicker label="compare" value={head} branches={info.branches} onChange={changeHead} />
            <button className={btn} onClick={doFetch} disabled={fetching} title="git fetch --all --prune">
              <IconRefresh width={14} height={14} className={fetching ? 'animate-spin' : ''} />
              Fetch
            </button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            className={`${btn} ${layout.reviewOpen ? 'text-accent' : ''}`}
            onClick={() => setLayout((l) => ({ ...l, reviewOpen: !l.reviewOpen }))}
            title="Toggle AI review panel"
          >
            <IconPanel width={15} height={15} />
          </button>
          <button className={btn} onClick={() => setShowSettings(true)} title="Settings (⌘/Ctrl+,)">
            <IconGear width={15} height={15} />
          </button>
        </div>
      </header>

      {commit && (
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-accent-soft px-3 py-2 dark:border-zinc-800">
          <span className="shrink-0 font-mono" title={commit.hash}>{commit.hash.slice(0, 7)}</span>
          <span className="truncate" title={commit.subject}>{commit.subject}</span>
          <span className="shrink-0 text-[11px] text-zinc-500">{cmp?.base === 'Empty tree' ? 'First commit · all files added' : 'Compared with first parent'}</span>
          <button onClick={() => setCommit(null)} className="ml-auto shrink-0 text-accent hover:underline">
            Back to branch comparison
          </button>
        </div>
      )}

      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-rose-200 bg-rose-50 px-3 py-1.5 text-rose-700 select-text dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
          <button className="ml-auto text-[12px] underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {!info ? (
        <div className="grid flex-1 place-items-center">
          <div className="w-[420px] text-center">
            <IconSparkle width={36} height={36} className="mx-auto text-accent" />
            <h1 className="mt-3 text-xl font-semibold">Review a branch</h1>
            <p className="mt-1 text-zinc-500">
              Open a git repository to compare a branch against <span className="font-mono">develop</span> side by
              side and get an AI summary with recommendations.
            </p>
            <button onClick={pickRepo} className="mt-5 h-9 rounded-md bg-accent px-4 font-medium text-white hover:brightness-110">
              Open repository…
            </button>
            {!!settings?.recentRepos.length && (
              <div className="mt-6 text-left">
                <div className="mb-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Recent</div>
                {settings.recentRepos.map((r) => (
                  <button
                    key={r}
                    onClick={() => openRepo(r)}
                    className="block w-full truncate rounded px-2 py-1 text-left font-mono text-[12px] hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div style={{ width: layout.sidebar }} className="shrink-0">
            <Sidebar
              key={`${info.repo}|${base}|${head}|${historyVersion}`}
              repo={info.repo}
              branches={info.branches}
              files={files}
              commit={commit}
              onSelectCommit={setCommit}
              selected={selected}
              onSelect={setSelected}
              loading={loading}
              error={error}
              base={base}
              head={head}
              merged={cmp?.merged}
              onUseBase={changeBase}
            />
          </div>
          <Splitter onDrag={(dx) => setLayout((l) => ({ ...l, sidebar: Math.max(200, Math.min(520, l.sidebar + dx)) }))} />
          <div className="min-w-0 flex-1">
            {cmp ? (
              <DiffView
                repo={info.repo}
                mergeBase={cmp.mergeBase}
                head={cmp.head}
                base={cmp.base}
                commitMode={!!commit}
                file={file}
                options={view}
                onOptions={setView}
                dark={dark}
                jump={jump}
                editorRef={editorRef}
              />
            ) : (
              <div className="grid h-full place-items-center text-zinc-400">
                {loading ? 'Comparing…' : 'Pick a base and a compare branch.'}
              </div>
            )}
          </div>
          {/* kept mounted while hidden so finished reviews survive toggling the panel */}
          <>
            {layout.reviewOpen && (
              <Splitter onDrag={(dx) => setLayout((l) => ({ ...l, review: Math.max(300, Math.min(800, l.review - dx)) }))} />
            )}
            <div style={{ width: layout.review }} className={layout.reviewOpen ? 'shrink-0' : 'hidden'}>
                <ReviewPanel
                  repo={info.repo}
                  base={commit ? cmp?.base ?? '' : base}
                  head={commit ? commit.hash : head}
                  commit={commit?.hash}
                  files={files}
                  settings={settings}
                  onJump={onJump}
                  onOpenSettings={() => setShowSettings(true)}
                  onClose={() => setLayout((l) => ({ ...l, reviewOpen: false }))}
                  runSignal={runSignal}
                />
            </div>
          </>
        </div>
      )}

      {showSettings && settings && (
        <SettingsDialog settings={settings} onSave={saveSettings} onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}

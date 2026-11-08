import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangedFile, Commit } from '@shared/types'

const STATUS_STYLE: Record<string, string> = {
  A: 'text-emerald-600 dark:text-emerald-400',
  M: 'text-amber-600 dark:text-amber-400',
  D: 'text-rose-600 dark:text-rose-400',
  R: 'text-sky-600 dark:text-sky-400',
  C: 'text-sky-600 dark:text-sky-400'
}

interface Props {
  files: ChangedFile[]
  commits: Commit[]
  selected: string | null
  onSelect: (path: string) => void
  loading: boolean
}

export default function Sidebar({ files, commits, selected, onSelect, loading }: Props) {
  const [tab, setTab] = useState<'files' | 'commits'>('files')
  const [q, setQ] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? files.filter((f) => f.path.toLowerCase().includes(s)) : files
  }, [files, q])

  const totals = useMemo(
    () =>
      files.reduce((t, f) => ({ add: t.add + (f.additions ?? 0), del: t.del + (f.deletions ?? 0) }), { add: 0, del: 0 }),
    [files]
  )

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <aside className="flex h-full flex-col border-r border-zinc-200 bg-zinc-50/60 dark:border-zinc-800/80 dark:bg-[#0f1218]">
      <div className="flex items-center gap-1 border-b border-zinc-200 px-2 pt-2 dark:border-zinc-800/80">
        {(['files', 'commits'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-2 pb-1.5 text-[12px] capitalize ${
              tab === t ? 'border-accent font-medium text-zinc-900 dark:text-zinc-50' : 'border-transparent text-zinc-500'
            }`}
          >
            {t} <span className="text-zinc-400">{t === 'files' ? files.length : commits.length}</span>
          </button>
        ))}
        {tab === 'files' && files.length > 0 && (
          <span className="ml-auto pb-1.5 font-mono text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400">+{totals.add}</span>{' '}
            <span className="text-rose-600 dark:text-rose-400">−{totals.del}</span>
          </span>
        )}
      </div>

      {tab === 'files' ? (
        <>
          <div className="p-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter files…"
              className="h-7 w-full rounded-md border border-zinc-200 bg-white px-2 outline-none focus:border-accent dark:border-zinc-800 dark:bg-zinc-900"
            />
          </div>
          <div ref={listRef} className="flex-1 overflow-y-auto pb-2">
            {loading && <div className="px-3 py-2 text-zinc-400">Loading…</div>}
            {!loading && files.length === 0 && (
              <div className="px-3 py-2 text-zinc-400">No changes between these branches.</div>
            )}
            {shown.map((f) => {
              const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
              const name = f.path.slice(f.path.lastIndexOf('/') + 1)
              const isSel = f.path === selected
              return (
                <button
                  key={f.path}
                  data-selected={isSel}
                  onClick={() => onSelect(f.path)}
                  title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                  className={`group flex w-full items-center gap-2 px-3 py-1 text-left ${
                    isSel ? 'bg-accent-soft' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <span className={`w-3 shrink-0 font-mono text-[11px] font-bold ${STATUS_STYLE[f.status] ?? ''}`}>
                    {f.status}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${f.status === 'D' ? 'line-through opacity-60' : ''}`}>{name}</span>
                    {dir && <span className="block truncate text-[11px] text-zinc-400">{dir}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px]">
                    {f.binary ? (
                      <span className="text-zinc-400">bin</span>
                    ) : (
                      <>
                        <span className="text-emerald-600 dark:text-emerald-400">+{f.additions}</span>{' '}
                        <span className="text-rose-600 dark:text-rose-400">−{f.deletions}</span>
                      </>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {commits.length === 0 && <div className="px-3 py-2 text-zinc-400">No commits.</div>}
          {commits.map((c) => (
            <div key={c.hash} className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
              <div className="select-text leading-snug">{c.subject}</div>
              <div className="mt-0.5 flex gap-2 text-[11px] text-zinc-400">
                <span className="font-mono">{c.hash}</span>
                <span className="truncate">{c.author}</span>
                <span className="ml-auto shrink-0">{c.date}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

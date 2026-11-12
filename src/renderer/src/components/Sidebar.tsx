import { useEffect, useMemo, useRef, useState } from 'react'
import type { Branch, ChangedFile, Commit, MergedInfo } from '@shared/types'
import BranchPicker from './BranchPicker'

const STATUS_STYLE: Record<string, string> = {
  A: 'text-emerald-600 dark:text-emerald-400',
  M: 'text-amber-600 dark:text-amber-400',
  D: 'text-rose-600 dark:text-rose-400',
  R: 'text-sky-600 dark:text-sky-400',
  C: 'text-sky-600 dark:text-sky-400'
}

interface Props {
  repo: string
  branches: Branch[]
  files: ChangedFile[]
  commit: Commit | null
  onSelectCommit: (commit: Commit | null) => void
  selected: string | null
  onSelect: (path: string) => void
  loading: boolean
  error: string | null
  base: string
  head: string
  merged?: MergedInfo
  /** Switch the base ref, e.g. to the commit before the branch was merged. */
  onUseBase: (ref: string) => void
}

function EmptyState({ base, head, merged, onUseBase }: Pick<Props, 'base' | 'head' | 'merged' | 'onUseBase'>) {
  const mono = 'font-mono text-zinc-700 dark:text-zinc-300'
  if (!merged) return <div className="px-3 py-2 text-zinc-400">No changes between these branches.</div>
  if (merged.sameCommit)
    return (
      <div className="px-3 py-2 text-zinc-400">
        <span className={mono}>{head}</span> and <span className={mono}>{base}</span> point at the same commit.
      </div>
    )
  return (
    <div className="m-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-[12.5px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
      <div className="font-medium text-zinc-800 dark:text-zinc-200">Already merged</div>
      <p className="mt-1">
        <span className={`${mono} break-all`}>{head}</span> is already part of <span className={mono}>{base}</span>, so there is
        nothing left to review.
      </p>
      {merged.mergeCommit && (
        <p className="mt-1.5 text-[12px]">
          Merged in <span className="font-mono">{merged.mergeCommit}</span>
          {merged.mergeSubject && <span className="block truncate text-zinc-500" title={merged.mergeSubject}>{merged.mergeSubject}</span>}
        </p>
      )}
      {merged.beforeMerge ? (
        <button
          onClick={() => onUseBase(merged.beforeMerge!)}
          className="mt-2.5 w-full rounded-md bg-accent px-2 py-1.5 font-medium text-white hover:brightness-110"
        >
          Show what it changed
        </button>
      ) : (
        <p className="mt-1.5 text-[12px]">It was fast-forwarded, so there is no merge commit to compare against.</p>
      )}
    </div>
  )
}

export default function Sidebar({ repo, branches, files, commit, onSelectCommit, selected, onSelect, loading, error, base, head, merged, onUseBase }: Props) {
  const [tab, setTab] = useState<'files' | 'commits'>('files')
  const [historyBranch, setHistoryBranch] = useState(head)
  const [commits, setCommits] = useState<Commit[]>([])
  const [skip, setSkip] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [retry, setRetry] = useState(0)
  const historyHead = useRef(head)
  const [q, setQ] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const branchName = branches.find((b) => b.name === historyBranch)?.remote
    ? historyBranch.slice(historyBranch.indexOf('/') + 1)
    : historyBranch
  const isMainBranch = historyBranch === base || ['main', 'master', 'develop', 'dev'].includes(branchName)
  const historyBase = isMainBranch || !base ? undefined : base

  useEffect(() => {
    if (!historyBranch) return
    let stale = false
    setHistoryLoading(true)
    setHistoryError('')
    window.api.listCommits(repo, historyHead.current, skip, historyBase)
      .then((page) => {
        if (stale) return
        if (skip === 0 && page[0]) historyHead.current = page[0].hash
        setCommits((previous) => skip === 0 ? page : [...previous, ...page])
        setHasMore(page.length === 100)
      })
      .catch((e) => !stale && setHistoryError(String(e.message ?? e)))
      .finally(() => !stale && setHistoryLoading(false))
    return () => { stale = true }
  }, [repo, historyBranch, historyBase, skip, retry])

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
            {t} <span className="text-zinc-400">{t === 'files' ? files.length : `${commits.length}${hasMore ? '+' : ''}`}</span>
          </button>
        ))}
        {tab === 'files' && files.length > 0 && (
          <span className="ml-auto pb-1.5 font-mono text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400">+{totals.add}</span>{' '}
            <span className="text-rose-600 dark:text-rose-400">−{totals.del}</span>
          </span>
        )}
      </div>

      {(tab === 'commits' || commit) && (
        <div className="shrink-0 border-b border-zinc-200 p-2 dark:border-zinc-800/80">
          <BranchPicker
            label="history"
            value={historyBranch}
            branches={branches}
            onChange={(branch) => {
              if (branch === historyBranch) return
              historyHead.current = branch
              setSkip(0)
              setCommits([])
              setHasMore(false)
              onSelectCommit(null)
              setTab('commits')
              setHistoryBranch(branch)
            }}
          />
          {historyBase && <div className="mt-1 text-[11px] text-zinc-500">Commits ahead of {historyBase}</div>}
        </div>
      )}

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
            {!loading && !error && files.length === 0 && (
              commit
                ? <div className="px-3 py-2 text-zinc-400">This commit has no file changes against its first parent.</div>
                : <EmptyState base={base} head={head} merged={merged} onUseBase={onUseBase} />
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
          <div className="px-3 py-2 text-[11px] text-zinc-500">Select a commit to view its changes.</div>
          {!historyLoading && !historyError && commits.length === 0 && (
            <div className="px-3 py-2 text-zinc-400">
              {historyBase ? `No commits ahead of ${historyBase}.` : 'No commits.'}
            </div>
          )}
          {commits.map((c) => (
            <button
              key={c.hash}
              aria-pressed={commit?.hash === c.hash}
              onClick={() => {
                onSelectCommit(c)
                setQ('')
              }}
              className={`block w-full border-b border-zinc-100 px-3 py-2 text-left dark:border-zinc-800/60 ${
                commit?.hash === c.hash ? 'bg-accent-soft' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
              }`}
            >
              <div className="select-text leading-snug">{c.subject}</div>
              <div className="mt-0.5 flex gap-2 text-[11px] text-zinc-400">
                <span className="font-mono" title={c.hash}>{c.hash.slice(0, 7)}</span>
                <span className="truncate">{c.author}</span>
                <span className="ml-auto shrink-0">{c.date}</span>
              </div>
            </button>
          ))}
          {historyError && (
            <div className="px-3 py-2 text-rose-500">
              {historyError}
              <button onClick={() => setRetry((n) => n + 1)} className="ml-2 underline">Retry</button>
            </div>
          )}
          {historyLoading && <div className="px-3 py-2 text-zinc-400">Loading history…</div>}
          {hasMore && !historyLoading && !historyError && (
            <button onClick={() => setSkip(commits.length)} className="w-full px-3 py-2 text-accent hover:underline">
              Load older commits
            </button>
          )}
        </div>
      )}
    </aside>
  )
}

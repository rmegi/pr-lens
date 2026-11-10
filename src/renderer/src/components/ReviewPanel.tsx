import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChangedFile, ErrorFix, ReviewEvent, Settings } from '@shared/types'
import { IconCopy, IconSparkle, IconX } from '../lib/icons'

function CopyCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center gap-1 rounded bg-black/10 px-1.5 py-0.5 font-mono text-[12px] dark:bg-white/10">
      <span className="select-text">{cmd}</span>
      <button
        title="Copy"
        onClick={() => {
          navigator.clipboard.writeText(cmd)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
        className="opacity-60 hover:opacity-100"
      >
        {copied ? '✓' : <IconCopy width={12} height={12} />}
      </button>
    </span>
  )
}

/** Error box with concrete steps when we know how to fix the problem. */
function ReviewError({ message, fix, onOpenSettings }: { message: string; fix?: ErrorFix; onOpenSettings: () => void }) {
  const box =
    'rounded-md border border-rose-300 bg-rose-50 p-3 text-rose-900 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-100'
  const settingsLink = (label: string) => (
    <button onClick={onOpenSettings} className="font-medium underline underline-offset-2">
      {label}
    </button>
  )

  if (fix === 'cli-login') {
    return (
      <div className={box}>
        <div className="font-semibold">Claude Code CLI login expired</div>
        <p className="mt-1 text-[12.5px] opacity-90">
          PR Lens runs the <code>claude</code> command on this computer, and its login has expired or is missing. This login is
          separate from the Claude desktop app.
        </p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[12.5px]">
          <li>
            Open a terminal and run <CopyCommand cmd="claude" />
          </li>
          <li>
            Type <CopyCommand cmd="/login" /> and finish signing in in the browser.
          </li>
          <li>Come back and click Run again. No restart needed.</li>
        </ol>
        <p className="mt-2 text-[12px] opacity-80">Or {settingsLink('use an Anthropic API key instead')}.</p>
        <details className="mt-2 text-[11px] opacity-70">
          <summary className="cursor-pointer">Error details</summary>
          <div className="mt-1 font-mono select-text">{message}</div>
        </details>
      </div>
    )
  }

  if (fix === 'cli-missing') {
    return (
      <div className={box}>
        <div className="font-semibold">Claude Code CLI not found</div>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[12.5px]">
          <li>
            Install Claude Code from{' '}
            <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer" className="underline">
              claude.com/claude-code
            </a>
            .
          </li>
          <li>
            Run <CopyCommand cmd="claude" /> once in a terminal and type <CopyCommand cmd="/login" />.
          </li>
          <li>Click Run again.</li>
        </ol>
        <p className="mt-2 text-[12px] opacity-80">Or {settingsLink('use an Anthropic API key instead')}.</p>
      </div>
    )
  }

  return (
    <div className={`${box} select-text`}>
      {message}
      {(fix === 'api-key' || /key|credential|not found|provider/i.test(message)) && (
        <div className="mt-2">{settingsLink('Open Settings')}</div>
      )}
    </div>
  )
}

interface ReviewState {
  id: string
  text: string
  status: string
  note?: string
  error?: string
  fix?: ErrorFix
  running: boolean
  confirmBytes?: number
  at: number
}

interface Props {
  repo: string
  base: string
  head: string
  files: ChangedFile[]
  settings: Settings | null
  onJump: (path: string, line: number) => void
  onOpenSettings: () => void
  onClose: () => void
  runSignal: number
}

const LOC_RE = /^(.+?\.[\w.-]+|[\w./-]+):(\d+)(?:[-–]\d+)?$/

/** Turn `path:line` code spans that refer to changed files into clickable links. */
function linkify(html: string, files: ChangedFile[]): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  for (const code of Array.from(doc.querySelectorAll('code'))) {
    if (code.parentElement?.tagName === 'PRE') continue
    const m = LOC_RE.exec(code.textContent?.trim() ?? '')
    if (!m) continue
    const ref = m[1].replace(/^\.?\//, '')
    const file = files.find((f) => f.path === ref) ?? files.find((f) => f.path.endsWith('/' + ref))
    if (!file) continue
    code.classList.add('loc')
    code.setAttribute('data-path', file.path)
    code.setAttribute('data-line', m[2])
    code.setAttribute('title', `Open ${file.path} at line ${m[2]}`)
  }
  return doc.body.firstElementChild!.innerHTML
}

function fmtBytes(n: number) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`
}

export default function ReviewPanel({ repo, base, head, files, settings, onJump, onOpenSettings, onClose, runSignal }: Props) {
  const key = `${repo}|${base}|${head}`
  const store = useRef(new Map<string, ReviewState>())
  const [, force] = useState(0)
  const rerender = () => force((n) => n + 1)
  const review = store.current.get(key)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(
    () =>
      window.api.onReviewEvent((e: ReviewEvent) => {
        for (const [k, r] of store.current) {
          if (r.id !== e.id) continue
          const next = { ...r }
          if (e.type === 'status') next.status = e.text
          else if (e.type === 'replace') next.text = e.text
          else if (e.type === 'delta') next.text += e.text
          else if (e.type === 'done') Object.assign(next, { running: false, note: e.note, status: '' })
          else if (e.type === 'error') Object.assign(next, { running: false, error: e.message, fix: e.fix, status: '' })
          else if (e.type === 'confirm-large') Object.assign(next, { running: false, confirmBytes: e.bytes, status: '' })
          store.current.set(k, next)
          rerender()
        }
      }),
    []
  )

  const start = useCallback(
    (forceLarge = false) => {
      if (!base || !head) return
      const prev = store.current.get(key)
      if (prev?.running) return
      const id = crypto.randomUUID()
      store.current.set(key, { id, text: '', status: 'Starting…', running: true, at: Date.now() })
      stick.current = true
      rerender()
      window.api.startReview({ id, repo, base, head, force: forceLarge })
    },
    [key, repo, base, head]
  )

  const stop = () => {
    if (review?.running) window.api.cancelReview(review.id)
  }

  // Cmd/Ctrl+Enter from App
  useEffect(() => {
    if (runSignal) start()
  }, [runSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const html = useMemo(() => {
    if (!review?.text) return ''
    const raw = marked.parse(review.text, { async: false, gfm: true }) as string
    return linkify(DOMPurify.sanitize(raw), files)
  }, [review?.text, files])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [html])

  const providerLabel = settings?.provider === 'anthropic-api' ? `Anthropic API · ${settings.model}` : 'Claude Code CLI'

  return (
    <aside className="flex h-full min-w-0 flex-col border-l border-zinc-200 bg-zinc-50/60 dark:border-zinc-800/80 dark:bg-[#0f1218]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800/80">
        <IconSparkle width={15} height={15} className="text-accent" />
        <span className="font-medium">AI review</span>
        <button onClick={onOpenSettings} className="truncate text-[11px] text-zinc-400 hover:text-accent" title="Change provider in Settings">
          {providerLabel}
        </button>
        <div className="ml-auto flex items-center gap-1">
          {review?.text && !review.running && (
            <button
              title="Copy review as Markdown"
              onClick={() => navigator.clipboard.writeText(review.text)}
              className="grid h-6 w-6 place-items-center rounded text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
            >
              <IconCopy width={14} height={14} />
            </button>
          )}
          <button
            title="Hide panel"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
          >
            <IconX width={14} height={14} />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        {review?.running ? (
          <button
            onClick={stop}
            className="h-7 rounded-md border border-zinc-300 px-3 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => start()}
            disabled={!files.length}
            className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-40"
          >
            <IconSparkle width={14} height={14} />
            {review ? 'Run again' : 'Review this PR'}
          </button>
        )}
        <span className="truncate text-[11px] text-zinc-400">
          {review?.running ? review.status : review?.note ?? `${files.length} files · ⌘/Ctrl+Enter`}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        onClick={(e) => {
          const t = e.target instanceof Element ? (e.target.closest('[data-path]') as HTMLElement | null) : null
          if (t) onJump(t.dataset.path!, Number(t.dataset.line))
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-6"
      >
        {review?.confirmBytes && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
            This diff is {fmtBytes(review.confirmBytes)} (about {Math.round(review.confirmBytes / 4000)}k tokens). Large
            reviews take longer and cost more.
            <div className="mt-2">
              <button onClick={() => start(true)} className="rounded bg-amber-600 px-2 py-1 font-medium text-white">
                Send anyway
              </button>
            </div>
          </div>
        )}
        {review?.error && <ReviewError message={review.error} fix={review.fix} onOpenSettings={onOpenSettings} />}
        {!review && (
          <div className="mt-6 space-y-2 text-zinc-500">
            <p>
              Get a summary of <span className="font-mono text-zinc-700 dark:text-zinc-300">{head || '…'}</span> →{' '}
              <span className="font-mono text-zinc-700 dark:text-zinc-300">{base || '…'}</span>: what it does, whether
              it is a feature or a fix, risks, and concrete recommendations.
            </p>
            <p className="text-[12px]">File references in the review are clickable and open the diff at that line.</p>
          </div>
        )}
        {html && (
          <div className={`md ${review?.running ? 'caret' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {review?.running && !review.text && (
          <div className="mt-4 flex items-center gap-2 text-zinc-400">
            <span className="h-2 w-2 animate-ping rounded-full bg-accent" /> {review.status}
          </div>
        )}
      </div>
    </aside>
  )
}

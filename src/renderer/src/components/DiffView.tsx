import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { ChangedFile, FilePair } from '@shared/types'
import { languageFor, monaco } from '../lib/monaco'
import { IconDown, IconUp } from '../lib/icons'

export interface ViewOptions {
  sideBySide: boolean
  ignoreWhitespace: boolean
  hideUnchanged: boolean
  wordWrap: boolean
}

interface Props {
  repo: string
  mergeBase: string
  head: string
  base: string
  commitMode: boolean
  file: ChangedFile | null
  options: ViewOptions
  onOptions: (o: ViewOptions) => void
  dark: boolean
  jump: { path: string; line: number; nonce: number } | null
  editorRef: MutableRefObject<monaco.editor.IStandaloneDiffEditor | null>
}

function Toggle({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`h-6 rounded px-2 text-[11.5px] ${
        on
          ? 'bg-accent-soft font-medium text-accent'
          : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

export default function DiffView({ repo, mergeBase, head, base, commitMode, file, options, onOptions, dark, jump, editorRef }: Props) {
  const [pair, setPair] = useState<FilePair | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const showEditor = Boolean(!error && file && pair && !pair.binary && !pair.tooLarge)

  useLayoutEffect(() => () => {
    const editor = editorRef.current
    const models = editor?.getModel()
    // Detach models before the React wrapper disposes them; Monaco requires this order.
    editor?.setModel(null)
    models?.original.dispose()
    models?.modified.dispose()
    editorRef.current = null
    decorations.current = null
  }, [showEditor, editorRef])

  useEffect(() => {
    if (!file) {
      setPair(null)
      return
    }
    let stale = false
    setLoading(true)
    setError(null)
    window.api
      .filePair(repo, mergeBase, head, file)
      .then((p) => !stale && setPair(p))
      .catch((e) => !stale && setError(String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
  }, [repo, mergeBase, head, file])

  // Jump to a line (from AI review links) once the diff for that file is shown.
  useEffect(() => {
    const ed = editorRef.current
    if (!jump || !ed || !pair || jump.path !== file?.path) return
    const go = () => {
      const mod = ed.getModifiedEditor()
      const line = Math.max(1, Math.min(jump.line, mod.getModel()?.getLineCount() ?? jump.line))
      mod.revealLineInCenter(line)
      mod.setPosition({ lineNumber: line, column: 1 })
      decorations.current?.clear()
      decorations.current = mod.createDecorationsCollection([
        {
          range: new monaco.Range(line, 1, line, 1),
          options: { isWholeLine: true, className: 'bg-accent-soft', linesDecorationsClassName: 'border-l-4 border-accent' }
        }
      ])
      setTimeout(() => decorations.current?.clear(), 2500)
    }
    const t = setTimeout(go, 120)
    return () => clearTimeout(t)
  }, [jump, pair, file, editorRef])

  const set = (patch: Partial<ViewOptions>) => onOptions({ ...options, ...patch })

  return (
    <section className="flex h-full min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800/80">
        {file ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[12px] select-text">
              {file.oldPath && <span className="text-zinc-400">{file.oldPath} → </span>}
              {file.path}
            </span>
          </div>
        ) : (
          <span className="text-zinc-400">No file selected</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            title="Previous change  ["
            onClick={() => editorRef.current?.goToDiff('previous')}
            className="grid h-6 w-6 place-items-center rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <IconUp width={14} height={14} />
          </button>
          <button
            title="Next change  ]"
            onClick={() => editorRef.current?.goToDiff('next')}
            className="grid h-6 w-6 place-items-center rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <IconDown width={14} height={14} />
          </button>
          <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
          <Toggle on={options.sideBySide} onClick={() => set({ sideBySide: true })}>
            Side by side
          </Toggle>
          <Toggle on={!options.sideBySide} onClick={() => set({ sideBySide: false })}>
            Inline
          </Toggle>
          <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
          <Toggle on={options.hideUnchanged} onClick={() => set({ hideUnchanged: !options.hideUnchanged })} title="Collapse unchanged regions">
            Collapse unchanged
          </Toggle>
          <Toggle on={options.ignoreWhitespace} onClick={() => set({ ignoreWhitespace: !options.ignoreWhitespace })}>
            Ignore whitespace
          </Toggle>
          <Toggle on={options.wordWrap} onClick={() => set({ wordWrap: !options.wordWrap })}>
            Wrap
          </Toggle>
        </div>
      </div>

      {file && options.sideBySide && (
        <div className="grid shrink-0 grid-cols-2 border-b border-zinc-200 font-mono text-[11px] text-zinc-500 dark:border-zinc-800/80">
          <div className="truncate px-3 py-1">
            {commitMode ? (base === 'Empty tree' ? base : `Parent ${base.slice(0, 7)}`) : base}
            {!commitMode && <span className="text-zinc-400"> (merge-base {mergeBase.slice(0, 7)})</span>}
          </div>
          <div className="truncate border-l border-zinc-200 px-3 py-1 dark:border-zinc-800/80">{commitMode ? `Commit ${head.slice(0, 7)}` : head}</div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {error && <div className="p-4 text-rose-500 select-text">{error}</div>}
        {!error && pair && (pair.binary || pair.tooLarge) && (
          <div className="grid h-full place-items-center text-zinc-400">
            {pair.binary ? 'Binary file, no text diff to show.' : 'This file is larger than 5 MB, so it is not shown.'}
          </div>
        )}
        {showEditor && file && pair && (
          <DiffEditor
            original={pair.original}
            modified={pair.modified}
            language={languageFor(file.path)}
            theme={dark ? 'prlens-dark' : 'prlens-light'}
            onMount={(ed) => {
              editorRef.current = ed
            }}
            options={{
              readOnly: true,
              originalEditable: false,
              renderSideBySide: options.sideBySide,
              useInlineViewWhenSpaceIsLimited: false,
              ignoreTrimWhitespace: options.ignoreWhitespace,
              hideUnchangedRegions: { enabled: options.hideUnchanged, contextLineCount: 4, minimumLineCount: 6 },
              wordWrap: options.wordWrap ? 'on' : 'off',
              diffWordWrap: options.wordWrap ? 'on' : 'off',
              renderOverviewRuler: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12.5,
              fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Cascadia Code', 'Ubuntu Mono', Menlo, monospace",
              automaticLayout: true,
              renderIndicators: true,
              diffAlgorithm: 'advanced'
            }}
          />
        )}
        {loading && !pair && <div className="p-4 text-zinc-400">Loading file…</div>}
      </div>
    </section>
  )
}

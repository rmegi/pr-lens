import { useEffect, useMemo, useRef, useState } from 'react'
import type { Branch } from '@shared/types'
import { IconBranch, IconChevron } from '../lib/icons'

interface Props {
  label: string
  value: string
  branches: Branch[]
  onChange: (name: string) => void
}

export default function BranchPicker({ label, value, branches, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? branches.filter((b) => b.name.toLowerCase().includes(s)) : branches
  }, [q, branches])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  useEffect(() => setActive(0), [q, open])

  const pick = (name: string) => {
    onChange(name)
    setOpen(false)
    setQ('')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 max-w-[260px] items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 text-left hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
        title={`${label}: ${value}`}
      >
        <span className="text-[11px] text-zinc-400">{label}</span>
        <IconBranch width={13} height={13} className="shrink-0 text-zinc-400" />
        <span className="truncate font-mono text-[12px]">{value || 'select…'}</span>
        <IconChevron width={13} height={13} className="shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-50 w-80 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, filtered.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && filtered[active]) pick(filtered[active].name)
              else if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="Filter branches…"
            className="w-full border-b border-zinc-200 bg-transparent px-3 py-2 outline-none dark:border-zinc-800"
          />
          <div className="max-h-80 overflow-y-auto py-1">
            {filtered.length === 0 && <div className="px-3 py-2 text-zinc-400">No branches match</div>}
            {filtered.map((b, i) => (
              <button
                key={b.name}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(b.name)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                  i === active ? 'bg-accent-soft' : ''
                } ${b.name === value ? 'font-semibold text-accent' : ''}`}
              >
                <span className="truncate font-mono text-[12px]">{b.name}</span>
                {b.remote && (
                  <span className="rounded bg-zinc-100 px-1 text-[10px] text-zinc-500 dark:bg-zinc-800">remote</span>
                )}
                <span className="ml-auto shrink-0 text-[11px] text-zinc-400">{b.date}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

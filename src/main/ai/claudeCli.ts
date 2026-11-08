import { spawn } from 'node:child_process'
import { findExecutable } from '../env'
import { SYSTEM_PROMPT } from './prompt'

export interface Sink {
  status(text: string): void
  replace(text: string): void
  done(note?: string): void
  error(message: string): void
}

function describeTool(name: string, input: Record<string, unknown>): string {
  const target = (input.file_path || input.path || input.pattern || '') as string
  const verb = name === 'Read' ? 'Reading' : name === 'Grep' ? 'Searching for' : name === 'Glob' ? 'Listing' : name
  return `${verb} ${target}`.trim()
}

/**
 * Runs the review through the Claude Code CLI in headless mode. It uses the
 * user's existing Claude Code login and can read the repo (read-only tools).
 */
export function runClaudeCli(opts: { repo: string; prompt: string; model: string; sink: Sink }): () => void {
  const bin = findExecutable('claude')
  if (!bin) {
    opts.sink.error(
      'The Claude Code CLI (`claude`) was not found. Install it from https://claude.com/claude-code, or switch to the Anthropic API provider in Settings.'
    )
    return () => {}
  }

  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--allowedTools',
    'Read',
    'Grep',
    'Glob',
    '--disallowedTools',
    'Bash',
    'Edit',
    'Write',
    'NotebookEdit',
    'WebFetch',
    'WebSearch',
    '--append-system-prompt',
    SYSTEM_PROMPT
  ]
  if (opts.model) args.push('--model', opts.model)

  const child = spawn(bin, args, { cwd: opts.repo, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
  let finished = false
  let cancelled = false
  let current = '' // text of the assistant message currently streaming
  let lastFull = '' // text of the last complete assistant message
  let buf = ''
  let stderr = ''

  opts.sink.status('Starting Claude Code…')

  const handle = (msg: any) => {
    if (msg.type === 'system' && msg.subtype === 'init') {
      opts.sink.status(`Claude Code ready (${msg.model ?? 'default model'}), reading the diff…`)
    } else if (msg.type === 'stream_event') {
      const ev = msg.event
      if (ev?.type === 'message_start') current = ''
      else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        current += ev.delta.text
        opts.sink.replace(current)
      }
    } else if (msg.type === 'assistant') {
      const blocks: any[] = msg.message?.content ?? []
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
      if (text) lastFull = text
      for (const b of blocks) if (b.type === 'tool_use') opts.sink.status(describeTool(b.name, b.input ?? {}))
    } else if (msg.type === 'result') {
      finished = true
      if (msg.is_error || msg.subtype !== 'success') {
        opts.sink.error(String(msg.result || msg.subtype || 'Claude Code reported an error'))
      } else {
        opts.sink.replace(String(msg.result ?? lastFull))
        const cost = typeof msg.total_cost_usd === 'number' ? ` · $${msg.total_cost_usd.toFixed(3)}` : ''
        const secs = typeof msg.duration_ms === 'number' ? `${Math.round(msg.duration_ms / 1000)}s` : ''
        opts.sink.done(`Claude Code · ${secs}${cost}`)
      }
    }
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        handle(JSON.parse(line))
      } catch {
        /* ignore non-JSON lines */
      }
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c: string) => (stderr += c))
  child.on('error', (err) => {
    if (!finished) opts.sink.error(`Could not start Claude Code: ${err.message}`)
    finished = true
  })
  child.on('close', (code) => {
    if (finished) return
    finished = true
    if (cancelled) opts.sink.done('Stopped')
    else opts.sink.error(stderr.trim() || `Claude Code exited with code ${code}`)
  })

  child.stdin.on('error', () => {})
  child.stdin.end(opts.prompt)

  return () => {
    cancelled = true
    child.kill('SIGTERM')
  }
}

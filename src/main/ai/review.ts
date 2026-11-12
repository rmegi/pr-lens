import path from 'node:path'
import type { ReviewEvent, ReviewRequest } from '@shared/types'
import { listBranches, reviewMaterial } from '../git'
import { getSettings, getStoredApiKey } from '../settings'
import { buildPrompt } from './prompt'
import { runClaudeCli, type Sink } from './claudeCli'
import { runAnthropicApi } from './anthropicApi'

/** Above this size we ask the user before sending (~100k tokens). */
const LARGE_DIFF_BYTES = 400_000

const running = new Map<string, () => void>()

export async function startReview(req: ReviewRequest, emit: (e: ReviewEvent) => void) {
  const id = req.id
  const sink: Sink = {
    status: (text) => emit({ id, type: 'status', text }),
    replace: (text) => emit({ id, type: 'replace', text }),
    done: (note) => {
      running.delete(id)
      emit({ id, type: 'done', note })
    },
    error: (message, fix) => {
      running.delete(id)
      emit({ id, type: 'error', message, fix })
    }
  }

  try {
    sink.status('Collecting the diff…')
    const [mat, info] = await Promise.all([reviewMaterial(req.repo, req.base, req.head, req.commit), listBranches(req.repo)])
    if (!mat.files.length) {
      sink.error(`No changes between ${req.base} and ${req.head}.`)
      return
    }
    const bytes = Buffer.byteLength(mat.diff)
    if (bytes > LARGE_DIFF_BYTES && !req.force) {
      emit({ id, type: 'confirm-large', bytes })
      return
    }

    const settings = getSettings()
    const prompt = buildPrompt({
      repoName: path.basename(req.repo),
      base: mat.base,
      head: mat.head,
      commit: req.commit,
      currentBranch: info.current,
      commits: mat.commits,
      files: mat.files,
      diff: mat.diff,
      reviewInstructions: settings.reviewInstructions,
      canReadRepo: settings.provider === 'claude-cli'
    })

    const cancel =
      settings.provider === 'claude-cli'
        ? runClaudeCli({ repo: req.repo, prompt, model: settings.model, sink })
        : runAnthropicApi({ apiKey: getStoredApiKey(), prompt, model: settings.model, sink })
    running.set(id, cancel)
  } catch (err) {
    sink.error(err instanceof Error ? err.message : String(err))
  }
}

export function cancelReview(id: string) {
  running.get(id)?.()
  running.delete(id)
}

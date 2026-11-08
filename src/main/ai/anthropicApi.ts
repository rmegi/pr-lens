import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT } from './prompt'
import type { Sink } from './claudeCli'

function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError)
    return 'The Anthropic API rejected the API key. Check it in Settings.'
  if (err instanceof Anthropic.PermissionDeniedError) return `Permission denied: ${err.message}`
  if (err instanceof Anthropic.NotFoundError) return `Model not found. Check the model name in Settings. (${err.message})`
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API. Wait a moment and try again.'
  if (err instanceof Anthropic.BadRequestError) return `The API rejected the request: ${err.message}`
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your network connection.'
  if (err instanceof Anthropic.APIError) return `Anthropic API error (${err.status ?? '?'}): ${err.message}`
  const msg = err instanceof Error ? err.message : String(err)
  if (/api.?key|credentials|auth/i.test(msg))
    return 'No Anthropic API key found. Add one in Settings, set ANTHROPIC_API_KEY, or switch to the Claude Code provider.'
  return msg
}

export function runAnthropicApi(opts: { apiKey?: string; prompt: string; model: string; sink: Sink }): () => void {
  const controller = new AbortController()
  let cancelled = false

  ;(async () => {
    try {
      // With no explicit key the SDK falls back to ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` profile.
      const client = opts.apiKey ? new Anthropic({ apiKey: opts.apiKey }) : new Anthropic()
      opts.sink.status(`Sending the diff to ${opts.model}…`)

      const stream = client.beta.messages.stream(
        {
          model: opts.model,
          max_tokens: 64000,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high' },
          // If a safety classifier declines, the API retries on a fallback model in the same call.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: opts.prompt }]
        },
        { signal: controller.signal }
      )

      let text = ''
      let started = false
      stream.on('text', (delta) => {
        if (!started) {
          started = true
          opts.sink.status('Writing the review…')
        }
        text += delta
        opts.sink.replace(text)
      })

      const msg = await stream.finalMessage()
      if (msg.stop_reason === 'refusal') {
        opts.sink.error('The model declined to review this diff.')
        return
      }
      const u = msg.usage
      const note = `${msg.model} · ${u.input_tokens.toLocaleString()} in / ${u.output_tokens.toLocaleString()} out tokens`
      if (msg.stop_reason === 'max_tokens') opts.sink.done(`${note} · output hit the length limit and is cut off`)
      else opts.sink.done(note)
    } catch (err) {
      if (cancelled) opts.sink.done('Stopped')
      else opts.sink.error(friendlyError(err))
    }
  })()

  return () => {
    cancelled = true
    controller.abort()
  }
}

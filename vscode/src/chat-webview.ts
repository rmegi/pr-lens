import { marked } from 'marked'
import DOMPurify from 'dompurify'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }
const vscode = acquireVsCodeApi()
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
let key = ''
let busy = false
let hasChanges = false
const question = element<HTMLTextAreaElement>('question')
const send = (type: string, values: object = {}) => vscode.postMessage({ type, key, ...values })

for (const type of ['review', 'stop', 'clear', 'settings', 'apiKey']) {
  element(type).addEventListener('click', () => send(type))
}
element('form').addEventListener('submit', (event) => {
  event.preventDefault()
  if (busy || !hasChanges || !question.value.trim()) return
  send('send', { text: question.value })
  question.value = ''
})
question.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    element<HTMLFormElement>('form').requestSubmit()
  }
})
element('messages').addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null
  const file = target?.closest<HTMLButtonElement>('button[data-path]')
  if (file) send('file', { path: file.dataset.path, line: Number(file.dataset.line) })
  const link = target?.closest<HTMLAnchorElement>('a')
  if (link) { event.preventDefault(); send('link', { href: link.href }) }
})
window.addEventListener('message', ({ data }) => {
  if (data?.type !== 'state') return
  const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 100
  if (key !== data.key) question.value = ''
  key = data.key
  busy = data.busy
  hasChanges = data.files.length > 0
  element('target').textContent = data.target ?? 'Select a comparison in the PR Lens sidebar.'
  element('provider').textContent = `${data.provider === 'claude-cli' ? 'Claude Code CLI' : 'Anthropic API'} · ${data.model || 'default model'}`
  element<HTMLButtonElement>('review').disabled = busy || !hasChanges
  element<HTMLButtonElement>('send').disabled = busy || !hasChanges
  element('stop').hidden = !busy
  element('empty').hidden = data.messages.length > 0
  element('status').textContent = data.status
  const help = data.fix === 'cli-login' ? '\nOpen a terminal, run claude, and use /login. Then try again.'
    : data.fix === 'cli-missing' ? '\nInstall Claude Code on the machine containing this repository, then log in with claude.'
    : data.fix === 'api-key' ? '\nUse the API key button to save a key, or choose Claude CLI in Settings.' : ''
  element('error').textContent = data.error ? data.error + help : ''
  element('error').hidden = !data.error
  const messages = element('messages')
  messages.replaceChildren()
  for (const message of data.messages) {
    const section = document.createElement('section')
    section.className = 'message'
    const role = document.createElement('div')
    role.className = 'role'
    role.textContent = message.role === 'user' ? 'You' : 'Assistant'
    const body = document.createElement('div')
    body.className = message.role
    if (message.role === 'user') body.textContent = message.text
    else {
      body.innerHTML = DOMPurify.sanitize(marked.parse(message.text, { async: false }) as string, { FORBID_TAGS: ['img', 'style'], FORBID_ATTR: ['style'] })
      for (const code of body.querySelectorAll('code')) {
        if (code.parentElement?.tagName === 'PRE') continue
        const match = /^(.+?):(\d+)(?:[-–]\d+)?$/.exec(code.textContent?.trim() ?? '')
        if (!match) continue
        const path = match[1].replace(/^\.\//, '')
        if (!data.files.includes(path)) continue
        const button = document.createElement('button')
        button.className = 'location'
        button.textContent = code.textContent
        button.dataset.path = path
        button.dataset.line = match[2]
        code.replaceChildren(button)
      }
    }
    section.append(role, body)
    messages.append(section)
  }
  if (atBottom && !question.matches(':focus')) window.scrollTo(0, document.documentElement.scrollHeight)
})
send('ready')

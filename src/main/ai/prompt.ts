import type { ChangedFile, Commit } from '@shared/types'

export const SYSTEM_PROMPT = `You are a senior software engineer doing a pull request review for a teammate.
Be concrete and specific to this diff. Prefer a few high-value findings over many nitpicks, and say plainly when something looks fine.
Only claim a bug when the diff supports it; when you are unsure, say what you would check.`

export interface PromptInput {
  repoName: string
  base: string
  head: string
  currentBranch: string
  commits: Commit[]
  files: ChangedFile[]
  diff: string
  reviewInstructions: string
  canReadRepo: boolean
}

export function buildPrompt(p: PromptInput): string {
  const stats = p.files
    .map((f) => {
      const counts = f.binary ? 'binary' : `+${f.additions ?? 0} -${f.deletions ?? 0}`
      const rename = f.oldPath ? ` (renamed from ${f.oldPath})` : ''
      return `${f.status} ${f.path}${rename} ${counts}`
    })
    .join('\n')
  const commits = p.commits.map((c) => `- ${c.hash} ${c.subject} (${c.author})`).join('\n') || '(none)'

  const repoNote = p.canReadRepo
    ? `\nYou may use the Read, Grep and Glob tools to look at surrounding code for context. The working tree is checked out at \`${p.currentBranch}\`, which may differ from \`${p.head}\`, so treat the diff below as the source of truth for what changed.\n`
    : ''

  const extra = p.reviewInstructions.trim()
    ? `\n<team_review_guidelines>\n${p.reviewInstructions.trim()}\n</team_review_guidelines>\n`
    : ''

  return `Review the changes that branch \`${p.head}\` would merge into \`${p.base}\` in the repository "${p.repoName}".
${repoNote}${extra}
<commits>
${commits}
</commits>

<changed_files>
${stats}
</changed_files>

<diff>
${p.diff}
</diff>

Write the review in GitHub-flavored Markdown with exactly these sections:

## Summary
Two to four sentences: what this change does, in plain language.

## Type & purpose
Classify it as one of Feature / Bug fix / Refactor / Performance / Chore / Docs / Tests (or a mix), and explain the problem it solves or the goal it serves, as far as the diff and commits show.

## Key changes
A short bullet list grouped by file or area.

## Risks & possible bugs
Bullets, most serious first. For each: what can go wrong, and when.

## Recommendations
Numbered list of concrete changes to make. Start each item with a location in backticks, as \`path/to/file.ext:LINE\`, where LINE is the line number in the new version of the file. Include a short code suggestion when it helps.

## Tests to add
Bullets naming specific cases.

Write "None found." in a section when nothing applies.`
}

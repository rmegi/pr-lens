import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Branch, ChangedFile, Comparison, FilePair, FileStatus, RepoInfo, MergedInfo } from '@shared/types'

const exec = promisify(execFile)
const MAX_BUFFER = 256 * 1024 * 1024
const MAX_FILE_BYTES = 5 * 1024 * 1024

export class GitError extends Error {}

async function git(repo: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', args, { cwd: repo, maxBuffer: MAX_BUFFER })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; message?: string; code?: string }
    if (e.code === 'ENOENT') throw new GitError('git was not found on PATH. Install git and restart PR Lens.')
    throw new GitError((e.stderr || e.message || 'git failed').toString().trim())
  }
}

/** Resolve and validate a repository path; returns the repo top-level dir. */
export async function resolveRepo(repoPath: string): Promise<string> {
  if (!repoPath) throw new GitError('No repository path given')
  const expanded = repoPath.replace(/^~(?=$|\/)/, os.homedir())
  const abs = path.resolve(expanded)
  if (!fs.existsSync(abs)) throw new GitError(`Path does not exist: ${abs}`)
  try {
    return (await git(abs, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    throw new GitError(`Not a git repository: ${abs}`)
  }
}

/** Reject refs that could be parsed as git options or contain odd characters. */
function checkRef(ref: string, label: string): string {
  if (!ref) throw new GitError(`Pick a ${label} branch`)
  if (ref.startsWith('-') || /[\s~^:?*[\\]/.test(ref) || ref.includes('..'))
    throw new GitError(`Invalid ${label} ref: ${ref}`)
  return ref
}

function checkHash(h: string): string {
  if (!/^[0-9a-f]{7,64}$/i.test(h)) throw new GitError(`Invalid commit: ${h}`)
  return h
}

export async function listBranches(repo: string): Promise<RepoInfo> {
  const out = await git(repo, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%09%(committerdate:relative)%09%(refname)',
    'refs/heads',
    'refs/remotes'
  ])
  const branches: Branch[] = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, date, full] = line.split('\t')
      return { name, date, remote: full.startsWith('refs/remotes/') }
    })
    // drop symbolic remote HEADs ("origin/HEAD", which short-names to "origin")
    .filter((b) => !b.name.endsWith('/HEAD') && !(b.remote && !b.name.includes('/')))

  let current = ''
  try {
    current = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  } catch {
    /* empty repo */
  }

  const names = new Set(branches.map((b) => b.name))
  const defaultBase =
    ['develop', 'origin/develop', 'dev', 'origin/dev', 'main', 'origin/main', 'master', 'origin/master'].find((n) =>
      names.has(n)
    ) ||
    branches[0]?.name ||
    ''

  return { repo, name: path.basename(repo), current, defaultBase, branches }
}

export async function fetchAll(repo: string): Promise<void> {
  await git(repo, ['fetch', '--all', '--prune'])
}

/**
 * Files changed on `head` since its merge-base with `base` (three-dot),
 * i.e. exactly what a PR from head into base shows.
 */
export async function compare(
  repo: string,
  base: string,
  head: string,
  ignoreWhitespace: boolean
): Promise<Comparison> {
  checkRef(base, 'base')
  checkRef(head, 'compare')
  const mergeBase = (await git(repo, ['merge-base', base, head])).trim().split('\n')[0]
  if (!mergeBase) throw new GitError(`${base} and ${head} have no common history`)
  const ws = ignoreWhitespace ? ['-w'] : []

  // -z gives NUL-separated, unquoted output: robust for any file name.
  const [rawStatus, rawNum, log] = await Promise.all([
    git(repo, ['diff', '-z', '--name-status', '--find-renames', mergeBase, head]),
    git(repo, ['diff', '-z', '--numstat', '--find-renames', ...ws, mergeBase, head]),
    git(repo, ['log', '--no-merges', '--format=%h%x09%an%x09%ar%x09%s', `${base}..${head}`])
  ])

  // name-status -z: STATUS\0path\0  or  RXXX\0old\0new\0
  const files: ChangedFile[] = []
  const st = rawStatus.split('\0')
  for (let i = 0; i < st.length - 1; ) {
    const code = st[i++]
    if (!code) continue
    const status = code[0] as FileStatus
    if (status === 'R' || status === 'C') {
      const oldPath = st[i++]
      const p = st[i++]
      files.push({ path: p, oldPath, status, additions: 0, deletions: 0, binary: false })
    } else {
      files.push({ path: st[i++], status, additions: 0, deletions: 0, binary: false })
    }
  }

  // numstat -z: "add\tdel\tpath\0"  or for renames "add\tdel\t\0old\0new\0"
  const byPath = new Map(files.map((f) => [f.path, f]))
  const nm = rawNum.split('\0')
  for (let i = 0; i < nm.length - 1; ) {
    const rec = nm[i++]
    if (!rec) continue
    const [add, del, p0] = rec.split('\t')
    let p = p0
    if (p === '') {
      i++ // old path
      p = nm[i++]
    }
    const f = byPath.get(p)
    if (!f) continue
    f.binary = add === '-'
    f.additions = add === '-' ? null : Number(add)
    f.deletions = del === '-' ? null : Number(del)
  }
  // With -w, files whose only changes were whitespace have no numstat → zero counts; keep them listed.

  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, ...subject] = line.split('\t')
      return { hash, author, date, subject: subject.join('\t') }
    })

  files.sort((a, b) => a.path.localeCompare(b.path))
  const merged = files.length === 0 ? await findMerge(repo, base, head, mergeBase) : undefined
  return { base, head, mergeBase, files, commits, merged }
}

async function isAncestor(repo: string, a: string, b: string): Promise<boolean> {
  try {
    await git(repo, ['merge-base', '--is-ancestor', a, b]) // exit 1 = not an ancestor
    return true
  } catch {
    return false
  }
}

/**
 * The diff is empty. If that is because `head` is already part of `base`, find the merge commit
 * that brought it in, so the UI can offer to compare against `base` as it was before that merge.
 */
async function findMerge(repo: string, base: string, head: string, mergeBase: string): Promise<MergedInfo | undefined> {
  const [headSha, baseSha] = (await git(repo, ['rev-parse', `${head}^{commit}`, `${base}^{commit}`]))
    .trim()
    .split('\n')
  if (headSha === baseSha) return { sameCommit: true }
  if (mergeBase !== headSha) return undefined // diverged but identical content: nothing to explain

  // Merge commits that descend from head and lead to base, oldest first. The first one whose
  // first parent does not already contain head is the merge that brought the branch in.
  const merges = (await git(repo, ['rev-list', '--ancestry-path', '--merges', '--reverse', `${headSha}..${baseSha}`]))
    .split('\n')
    .filter(Boolean)
    .slice(0, 200)
  for (const m of merges) {
    const firstParent = (await git(repo, ['rev-parse', `${m}^1`])).trim()
    if (await isAncestor(repo, headSha, firstParent)) continue
    const [short, subject] = (await git(repo, ['log', '-1', '--format=%h%x09%s', m])).trim().split('\t')
    const beforeMerge = (await git(repo, ['rev-parse', '--short=12', firstParent])).trim()
    return { mergeCommit: short, mergeSubject: subject, beforeMerge }
  }
  return {} // fast-forwarded into base: there is no "before" commit to compare against
}

async function showBlob(repo: string, rev: string, file: string): Promise<{ text: string; binary: boolean; tooLarge: boolean }> {
  const spec = `${rev}:${file}`
  const size = Number((await git(repo, ['cat-file', '-s', spec])).trim())
  if (size > MAX_FILE_BYTES) return { text: '', binary: false, tooLarge: true }
  const { stdout } = await exec('git', ['cat-file', 'blob', spec], {
    cwd: repo,
    maxBuffer: MAX_BUFFER,
    encoding: 'buffer'
  })
  const buf = stdout as unknown as Buffer
  const binary = buf.subarray(0, 8000).includes(0)
  return { text: binary ? '' : buf.toString('utf8'), binary, tooLarge: false }
}

/** Left = file at merge-base, right = file at head. */
export async function filePair(repo: string, mergeBase: string, head: string, file: ChangedFile): Promise<FilePair> {
  checkHash(mergeBase)
  checkRef(head, 'compare')
  const leftPath = file.oldPath ?? file.path
  const left = file.status === 'A' ? null : await showBlob(repo, mergeBase, leftPath)
  const right = file.status === 'D' ? null : await showBlob(repo, head, file.path)
  return {
    original: left?.text ?? '',
    modified: right?.text ?? '',
    binary: Boolean(left?.binary || right?.binary),
    tooLarge: Boolean(left?.tooLarge || right?.tooLarge)
  }
}

/** Unified diff + commit log, used as the AI review input. */
export async function reviewMaterial(repo: string, base: string, head: string) {
  const cmp = await compare(repo, base, head, false)
  const diff = await git(repo, ['diff', '--no-color', '--find-renames', '-U5', cmp.mergeBase, head])
  return { ...cmp, diff }
}


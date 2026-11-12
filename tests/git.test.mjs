import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { compare, compareCommit, filePair, listCommits, reviewMaterial } from '../src/main/git.ts'
import { buildPrompt } from '../src/main/ai/prompt.ts'

function repository(t, format = 'sha1') {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'pr-lens-test-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main', `--object-format=${format}`)
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  const write = (file, text) => writeFileSync(path.join(repo, file), text)
  const commit = (subject) => {
    git('add', '.')
    git('commit', '-q', '--allow-empty', '-m', subject)
    return git('rev-parse', 'HEAD')
  }
  return { repo, git, write, commit }
}

for (const format of ['sha1', 'sha256']) {
  test(`first commit compares with the empty tree (${format})`, async (t) => {
    const r = repository(t, format)
    r.write('hello.txt', 'hello\n')
    const root = r.commit('Initial commit')
    const cmp = await compareCommit(r.repo, root, false)
    assert.equal(cmp.base, 'Empty tree')
    assert.equal(cmp.head, root)
    assert.deepEqual(cmp.files.map((f) => [f.path, f.status, f.additions]), [['hello.txt', 'A', 1]])
    assert.deepEqual(await filePair(r.repo, cmp.mergeBase, cmp.head, cmp.files[0]), {
      original: '', modified: 'hello\n', binary: false, tooLarge: false
    })
    const review = await reviewMaterial(r.repo, 'main', 'main', root)
    assert.match(review.diff, /\+hello/)
    assert.equal(review.commits.length, 1)
    assert.equal(review.commits[0].hash, root)
  })
}

test('selected commit shows only its changes and leaves the working tree alone', async (t) => {
  const r = repository(t)
  r.write('file.txt', 'before\n')
  const root = r.commit('Initial')
  r.write('file.txt', 'after\n')
  const selected = r.commit('Change file')
  r.write('later.txt', 'later\n')
  const tip = r.commit('Later change')
  r.write('file.txt', 'uncommitted edit\n')
  const status = r.git('status', '--porcelain')
  const cmp = await compareCommit(r.repo, selected.slice(0, 12), false)
  assert.equal(cmp.mergeBase, root)
  assert.equal(cmp.head, selected)
  assert.deepEqual(cmp.files.map((f) => f.path), ['file.txt'])
  const pair = await filePair(r.repo, cmp.mergeBase, cmp.head, cmp.files[0])
  assert.equal(pair.original, 'before\n')
  assert.equal(pair.modified, 'after\n')
  const review = await reviewMaterial(r.repo, 'main', 'main', selected)
  assert.match(review.diff, /\+after/)
  assert.doesNotMatch(review.diff, /later\.txt|uncommitted/)
  const history = await listCommits(r.repo, 'main', 0)
  assert.deepEqual(history.map((c) => c.hash), [tip, selected, root])
  assert.equal(r.git('rev-parse', 'HEAD'), tip)
  assert.equal(r.git('symbolic-ref', '--short', 'HEAD'), 'main')
  assert.equal(r.git('status', '--porcelain'), status)
  assert.equal(readFileSync(path.join(r.repo, 'file.txt'), 'utf8'), 'uncommitted edit\n')
})

test('merge commits use the first parent; branch comparison keeps merge-base behavior', async (t) => {
  const r = repository(t)
  r.write('root.txt', 'root\n')
  const root = r.commit('Initial')
  r.git('checkout', '-q', '-b', 'feature')
  r.write('feature.txt', 'feature\n')
  const feature = r.commit('Feature')
  r.git('checkout', '-q', 'main')
  r.write('main.txt', 'main\n')
  const parent = r.commit('Main change')
  const branch = await compare(r.repo, 'main', 'feature', false)
  assert.equal(branch.mergeBase, root)
  assert.deepEqual(branch.files.map((f) => f.path), ['feature.txt'])
  r.git('merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature')
  const merge = r.git('rev-parse', 'HEAD')
  const cmp = await compareCommit(r.repo, merge, false)
  assert.equal(cmp.mergeBase, parent)
  assert.deepEqual(cmp.files.map((f) => f.path), ['feature.txt'])
  assert.equal(cmp.commits[0].subject, 'Merge feature')
  assert.equal((await listCommits(r.repo, 'main', 0))[0].hash, merge)
  const merged = await compare(r.repo, 'main', 'feature', false)
  assert.equal(merged.files.length, 0)
  assert.ok(merged.merged.beforeMerge)
  const review = await reviewMaterial(r.repo, 'main', 'feature', merge)
  assert.deepEqual(review.commits.map((c) => c.hash), [merge])
  assert.doesNotMatch(review.diff, /main\.txt/)
  assert.notEqual(merge, feature)
})

test('renames, deleted files, binaries, whitespace and empty commits keep existing diff behavior', async (t) => {
  const r = repository(t)
  r.write('old name.txt', 'rename me\n')
  r.write('deleted.txt', 'delete me\n')
  r.write('spacing.txt', 'a b\n')
  r.commit('Initial')
  r.git('mv', 'old name.txt', 'new name.txt')
  r.git('rm', '-q', 'deleted.txt')
  r.write('binary.dat', Buffer.from([0, 1, 2]))
  r.write('spacing.txt', 'a  b\n')
  const selected = r.commit('Mixed changes')
  const cmp = await compareCommit(r.repo, selected, true)
  const renamed = cmp.files.find((f) => f.status === 'R')
  assert.equal(renamed.oldPath, 'old name.txt')
  assert.equal(renamed.path, 'new name.txt')
  assert.equal((await filePair(r.repo, cmp.mergeBase, cmp.head, renamed)).original, 'rename me\n')
  const deleted = cmp.files.find((f) => f.status === 'D')
  assert.equal((await filePair(r.repo, cmp.mergeBase, cmp.head, deleted)).modified, '')
  const binary = cmp.files.find((f) => f.binary)
  assert.equal((await filePair(r.repo, cmp.mergeBase, cmp.head, binary)).binary, true)
  assert.equal(cmp.files.find((f) => f.path === 'spacing.txt').additions, 0)
  const empty = r.commit('Empty commit')
  assert.deepEqual((await compareCommit(r.repo, empty, false)).files, [])
})

test('history pages reach old commits and reject invalid input', async (t) => {
  const r = repository(t)
  const hashes = []
  for (let i = 0; i < 105; i++) hashes.unshift(r.commit(`Commit ${i}`))
  const first = await listCommits(r.repo, 'main', 0)
  assert.equal(first.length, 100)
  r.commit('New tip')
  const second = await listCommits(r.repo, first[0].hash, 100)
  assert.deepEqual([...first, ...second].map((c) => c.hash), hashes)
  assert.deepEqual(await listCommits(r.repo, first[0].hash, 105), [])
  for (const offset of [-1, 0.5, NaN, '0']) {
    await assert.rejects(listCommits(r.repo, 'main', offset), /Invalid history offset/)
  }
  await assert.rejects(listCommits(r.repo, '--all', 0), /Invalid history ref/)
  await assert.rejects(compareCommit(r.repo, '--all', false), /Invalid commit/)
  await assert.rejects(compareCommit(r.repo, 'abcdef123456', false))
})

test('commit reviews describe the selected commit instead of a branch merge', () => {
  const prompt = buildPrompt({
    repoName: 'test', base: 'parent', head: 'abc1234', commit: 'abc1234', currentBranch: 'main',
    commits: [], files: [], diff: '', reviewInstructions: '', canReadRepo: true
  })
  assert.match(prompt, /Review commit `abc1234` compared with its first parent/)
  assert.match(prompt, /working tree is checked out at `main`/)
})

test('feature history excludes inherited commits and commits already merged into the base', async (t) => {
  const r = repository(t)
  for (let i = 0; i < 105; i++) r.commit(`Inherited ${i}`)
  r.git('checkout', '-q', '-b', 'feature')
  r.write('first.txt', 'first\n')
  const first = r.commit('First feature commit')
  r.write('second.txt', 'second\n')
  const second = r.commit('Second feature commit')
  assert.deepEqual((await listCommits(r.repo, 'feature', 0, 'main')).map((c) => c.hash), [second, first])
  assert.deepEqual((await listCommits(r.repo, 'feature', 1, 'main')).map((c) => c.hash), [first])
  assert.equal((await listCommits(r.repo, 'feature', 0)).length, 100)
  assert.equal((await listCommits(r.repo, 'main', 0)).length, 100)
  await assert.rejects(listCommits(r.repo, 'feature', 0, '--all'), /Invalid base ref/)
  r.git('checkout', '-q', 'main')
  r.git('merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature')
  assert.deepEqual(await listCommits(r.repo, 'feature', 0, 'main'), [])
})

test('a shallow boundary is not mistaken for the first commit', async (t) => {
  const r = repository(t)
  r.write('file.txt', 'before\n')
  r.commit('Initial')
  r.write('file.txt', 'after\n')
  const tip = r.commit('Change')
  const clone = mkdtempSync(path.join(os.tmpdir(), 'pr-lens-shallow-'))
  t.after(() => rmSync(clone, { recursive: true, force: true }))
  execFileSync('git', ['clone', '-q', '--depth=1', pathToFileURL(r.repo).href, clone])
  await assert.rejects(compareCommit(clone, tip, false), /bad object|bad revision/)
})

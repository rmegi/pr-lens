const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const temporary = mkdtempSync(path.join(os.tmpdir(), 'pr-lens-vscode-'))
try {
  const result = spawnSync(process.env.VSCODE_EXECUTABLE || 'code', [
    '--wait', '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-extensions',
    '--disable-workspace-trust',
    '--user-data-dir', path.join(temporary, 'profile'),
    '--extensions-dir', path.join(temporary, 'extensions'),
    `--extensionDevelopmentPath=${path.resolve(__dirname, '..')}`,
    `--extensionTestsPath=${path.join(__dirname, 'extension.test.cjs')}`,
    ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : [])
  ], {
    stdio: 'inherit', timeout: 120_000,
    env: { ...process.env, PR_LENS_TEST_DIRECTORY: temporary, PR_LENS_TEST_NODE: process.execPath, ELECTRON_RUN_AS_NODE: undefined }
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
  if (result.status === 0) {
    const checks = JSON.parse(readFileSync(path.join(temporary, 'results.json'), 'utf8'))
    for (const check of checks) console.log(check)
  }
} finally {
  rmSync(temporary, { recursive: true, force: true })
}

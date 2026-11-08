import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Apps launched from Finder / a desktop launcher don't inherit the shell PATH,
 * so `git` and `claude` may be missing. Add the usual install locations.
 */
export function fixPath() {
  const home = os.homedir()
  const extra = [
    path.join(home, '.local/bin'),
    path.join(home, '.claude/local'),
    path.join(home, '.npm-global/bin'),
    path.join(home, '.volta/bin'),
    path.join(home, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/snap/bin'
  ]
  const parts = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const p of extra) if (!parts.includes(p)) parts.push(p)
  process.env.PATH = parts.join(path.delimiter)
}

export function findExecutable(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const full = path.join(dir, name + ext)
      try {
        fs.accessSync(full, fs.constants.X_OK)
        if (fs.statSync(full).isFile()) return full
      } catch {
        /* keep looking */
      }
    }
  }
  return null
}

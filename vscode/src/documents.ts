import * as vscode from 'vscode'
import { filePair } from '../../src/main/git'
import type { ChangedFile, Comparison, FileStatus } from '../../src/shared/types'

export function diffUri(repo: string, comparison: Comparison, file: ChangedFile, side: 'original' | 'modified'): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'pr-lens',
    path: `/${side === 'original' ? file.oldPath ?? file.path : file.path}`,
    query: JSON.stringify({ repo, base: comparison.mergeBase, head: comparison.head, file, side })
  })
}

export class HistoricalDocuments implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const data = JSON.parse(uri.query)
    if (!data || typeof data.repo !== 'string' || typeof data.base !== 'string' || typeof data.head !== 'string'
      || !data.file || typeof data.file.path !== 'string'
      || (data.file.oldPath !== undefined && typeof data.file.oldPath !== 'string')
      || !['A', 'M', 'D', 'R', 'C', 'T', 'U'].includes(data.file.status)
      || !['original', 'modified'].includes(data.side)) {
      throw new Error('Invalid PR Lens document')
    }
    const file: ChangedFile = {
      path: data.file.path, oldPath: data.file.oldPath, status: data.file.status as FileStatus,
      additions: 0, deletions: 0, binary: false
    }
    const pair = await filePair(data.repo, data.base, data.head, file)
    if (pair.binary || pair.tooLarge) throw new Error(pair.binary ? 'Binary file: no text diff available.' : 'File exceeds the 5 MB preview limit.')
    return data.side === 'original' ? pair.original : pair.modified
  }
}

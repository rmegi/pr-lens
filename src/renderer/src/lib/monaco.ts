import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

// Use the bundled Monaco (offline) instead of the default CDN loader.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

// Files are shown out of their project context, so semantic errors would be noise.
for (const d of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true })
}

monaco.editor.defineTheme('prlens-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0d1117',
    'editorGutter.background': '#0d1117',
    'diffEditor.insertedTextBackground': '#2ea04333',
    'diffEditor.removedTextBackground': '#f8514933',
    'diffEditor.insertedLineBackground': '#2ea04318',
    'diffEditor.removedLineBackground': '#f8514918'
  }
})
monaco.editor.defineTheme('prlens-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'diffEditor.insertedTextBackground': '#2ea04333',
    'diffEditor.removedTextBackground': '#f8514933',
    'diffEditor.insertedLineBackground': '#2ea0431a',
    'diffEditor.removedLineBackground': '#f851491a'
  }
})

loader.config({ monaco })

let extMap: Map<string, string> | null = null
const NAME_MAP: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'plaintext',
  'cmakelists.txt': 'plaintext'
}

export function languageFor(path: string): string {
  const base = path.split('/').pop()!.toLowerCase()
  if (NAME_MAP[base]) return NAME_MAP[base]
  if (!extMap) {
    extMap = new Map()
    for (const lang of monaco.languages.getLanguages()) {
      for (const ext of lang.extensions ?? []) if (!extMap.has(ext.toLowerCase())) extMap.set(ext.toLowerCase(), lang.id)
      for (const fn of lang.filenames ?? []) extMap.set(fn.toLowerCase(), lang.id)
    }
  }
  if (extMap.has(base)) return extMap.get(base)!
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? extMap.get(base.slice(dot)) ?? 'plaintext' : 'plaintext'
}

export { monaco }

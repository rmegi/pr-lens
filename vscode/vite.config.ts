import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { conditions: ['node'], mainFields: ['module', 'main'] },
  build: {
    target: 'node20',
    outDir: 'out',
    lib: {
      entry: fileURLToPath(new URL('./src/extension.ts', import.meta.url)),
      formats: ['cjs'],
      fileName: () => 'extension.cjs'
    },
    rollupOptions: { external: ['vscode', ...builtinModules, /^node:/], output: { codeSplitting: false } },
    minify: false
  }
})

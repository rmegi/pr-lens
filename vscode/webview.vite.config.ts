import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'es2022', outDir: 'out', emptyOutDir: false,
    lib: { entry: fileURLToPath(new URL('./src/chat-webview.ts', import.meta.url)), formats: ['iife'], name: 'PrLensChat', fileName: () => 'chat.js' }
  }
})

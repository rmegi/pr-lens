import type { PrLensApi } from '../shared/types'

declare global {
  interface Window {
    api: PrLensApi
  }
}

export {}

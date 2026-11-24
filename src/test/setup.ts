import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Server tests run in node (`@vitest-environment node`), where there is no window to patch.
if (typeof window !== 'undefined') {
  // jsdom does no layout: no ResizeObserver, and every width is 0 (the chart falls back to its default).
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  beforeEach(() => {
    localStorage.clear()
    // Every suite opts in to the fetch it wants; an un-stubbed call should fail loudly.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('unstubbed fetch'))))
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
}

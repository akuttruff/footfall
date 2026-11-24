// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Collector, HISTORY_MS, OVERLAP_MS, WINDOW_MS, amplifyConfig, windows } from './collector.ts'
import { logText } from './fixtures.ts'
import { parseLog } from './logs.ts'
import { Store } from './store.ts'

const NOW = Date.parse('2026-11-09T18:00:00Z')

describe('windows', () => {
  it('starts thirteen days back the first time, a day at a time', () => {
    const w = windows(null, NOW)
    expect(w[0][0]).toBe(NOW - HISTORY_MS)
    expect(w.at(-1)![1]).toBe(NOW)
    expect(w).toHaveLength(13)
    for (const [s, e] of w) expect(e - s).toBeLessThanOrEqual(WINDOW_MS)
  })

  it('then picks up from the cursor, less the overlap', () => {
    expect(windows(NOW - 3600_000, NOW)).toEqual([[NOW - 3600_000 - OVERLAP_MS, NOW]])
  })

  it('never asks further back than Amplify keeps', () => {
    expect(windows(NOW - 60 * WINDOW_MS, NOW)[0][0]).toBe(NOW - HISTORY_MS)
  })
})

describe('amplifyConfig', () => {
  it('needs an app id and a domain and fills in the rest', () => {
    expect(amplifyConfig({})).toBeNull()
    expect(amplifyConfig({ AWS_AMPLIFY_APP_ID: 'd2' })).toBeNull()
    expect(amplifyConfig({ AWS_AMPLIFY_APP_ID: 'd2', FOOTFALL_DOMAIN: 'example.com' })).toEqual({ appId: 'd2', domain: 'example.com', profile: 'default', aws: 'aws' })
    expect(amplifyConfig({ AWS_AMPLIFY_APP_ID: 'd2', FOOTFALL_DOMAIN: 'example.com', AWS_PROFILE: 'site' })).toMatchObject({ profile: 'site' })
    expect(amplifyConfig({ FOOTFALL_APP_ID: 'x', AWS_AMPLIFY_APP_ID: 'd2', FOOTFALL_DOMAIN: 'example.com', FOOTFALL_AWS: '/opt/homebrew/bin/aws' })).toMatchObject({ appId: 'x', aws: '/opt/homebrew/bin/aws' })
  })
})

describe('Collector', () => {
  let dir: string
  let store: Store
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footfall-collector-'))
    store = new Store(dir)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('fetches every window, moves the cursor and records success', async () => {
    const source = vi.fn(async (start: number) => parseLog(logText([{ at: new Date(start + 1000).toISOString(), id: String(start) }])))
    const c = new Collector(store, source)
    expect(await c.fetch(NOW)).toBe(13)
    expect(source).toHaveBeenCalledTimes(13)
    expect(store.getNumber('cursor')).toBe(NOW)
    expect(c.status()).toEqual({ lastRunAt: NOW, lastOkAt: NOW, lastError: null, running: false, gaps: [] })
  })

  it('keeps what it got before a failure, says what went wrong, and resumes from there', async () => {
    let calls = 0
    const source = vi.fn(async () => {
      if (++calls === 3) throw Object.assign(new Error('Command failed'), { stderr: 'aws: [ERROR]: An error occurred (ExpiredToken)\n' })
      return []
    })
    const c = new Collector(store, source)
    await c.fetch(NOW)
    expect(c.status().lastError).toBe('aws: [ERROR]: An error occurred (ExpiredToken)')
    expect(c.status().lastOkAt).toBeNull()
    expect(store.getNumber('cursor')).toBe(NOW - HISTORY_MS + 2 * WINDOW_MS)
    await c.fetch(NOW)
    expect(c.status().lastError).toBeNull()
  })

  it('joins a round already running rather than starting another', async () => {
    let release = (): void => {}
    const source = vi.fn(() => new Promise<never[]>((r) => { release = () => r([]) }))
    const c = new Collector(store, source)
    store.set('cursor', String(NOW - 1000))
    const a = c.fetch(NOW)
    const b = c.fetch(NOW)
    expect(c.running).toBe(true)
    release()
    await Promise.all([a, b])
    expect(source).toHaveBeenCalledTimes(1)
  })

  it('records the span it can no longer get after the Mac was away longer than Amplify keeps', async () => {
    const away = NOW - 20 * WINDOW_MS
    store.set('cursor', String(away))
    const c = new Collector(store, vi.fn(async () => []))
    await c.fetch(NOW)
    expect(c.status().gaps).toEqual([{ from: away, to: NOW - HISTORY_MS }])
    // A normal round after that adds nothing.
    await c.fetch(NOW + 3600_000)
    expect(c.status().gaps).toHaveLength(1)
  })

  it('without an Amplify app, says so and fetches nothing', async () => {
    const c = new Collector(store, null)
    expect(await c.fetch(NOW)).toBe(0)
    expect(c.status().lastError).toMatch(/No Amplify app/)
  })
})

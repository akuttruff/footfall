// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localDay } from './classify.ts'
import { UA, logText } from './fixtures.ts'
import type { Req } from './fixtures.ts'
import { parseLog } from './logs.ts'
import { Store, addDays, dayCount } from './store.ts'

const IDLE = { lastRunAt: null, lastOkAt: null, lastError: null, running: false, gaps: [] }

let dir: string
let store: Store

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footfall-store-'))
  store = new Store(dir)
})
afterEach(() => {
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Noon UTC on a day, n days before the reference day, so the local day is the same everywhere in the Americas and Europe. */
const at = (day: string, hh = '18:00:00'): string => `${day}T${hh}Z`
const add = (reqs: Req[]): number => store.add(parseLog(logText(reqs)))

/** A real visit: the page, then the bundle it loads. */
const visit = (day: string, ip: string, extra: Partial<Req> = {}): Req[] => [
  { at: at(day), ip, path: '/', ...extra },
  { at: at(day, '18:00:01'), ip, path: '/static/index-abc.js', type: 'text/javascript', ua: extra.ua, referrer: 'https://www.example.com/' },
]

describe('Store', () => {
  const today = '2026-11-09'

  it('keeps each request once, drops redirects, and never stores an address', () => {
    const reqs: Req[] = [{ at: at(today), id: 'a' }, { at: at(today), id: 'b', status: 302, host: 'example.com' }]
    expect(add(reqs)).toBe(1)
    expect(add(reqs)).toBe(0)
    const dump = JSON.stringify(store.db.prepare('SELECT * FROM hits').all())
    expect(dump).not.toContain('203.0.113')
  })

  it('counts people, sets aside the unconfirmed and the bots, and says why', () => {
    add([
      ...visit(today, '203.0.113.1', { referrer: 'https://www.google.com/' }),
      { at: at(today, '18:05:00'), ip: '203.0.113.1', path: '/projects' },
      ...visit(today, '203.0.113.2', { ua: UA.iphone }),
      { at: at(today), ip: '203.0.113.3', path: '/' }, // the page and nothing else
      { at: at(today), ip: '203.0.113.4', path: '/', ua: UA.ahrefs },
      { at: at(today), ip: '203.0.113.5', path: '/', ua: UA.oldChrome },
      ...visit(today, '203.0.113.6'),
      { at: at(today), ip: '203.0.113.6', path: '/.env', status: 404 },
    ])
    const s = store.summary('7d', false, IDLE, today)
    expect(s.totals).toMatchObject({ visitors: 2, views: 3, unconfirmed: 1, bots: 3 })
    expect(s.pages).toEqual([{ key: '/', n: 2 }, { key: '/projects', n: 1 }])
    expect(s.referrers).toEqual([{ key: 'Direct or unknown', n: 1 }, { key: 'google.com', n: 1 }])
    expect(s.devices).toEqual([{ key: 'desktop', n: 1 }, { key: 'phone', n: 1 }])
    expect(s.bots.reasons).toEqual([{ key: 'crawler', n: 1 }, { key: 'probed for weak spots', n: 1 }, { key: 'stale browser', n: 1 }])
    expect(s.bots.probes).toEqual([{ key: '/.env', n: 1 }])
    expect(s.recent.map((v) => v.pages)).toEqual(expect.arrayContaining([['/', '/projects'], ['/']]))

    const all = store.summary('7d', true, IDLE, today)
    expect(all.totals).toMatchObject({ visitors: 3, views: 4 })
  })

  it('fills every day of the range and compares with the span before', () => {
    const local = (iso: string): string => localDay(Date.parse(iso))
    add([
      ...visit(today, '203.0.113.1'), ...visit(addDays(today, -2), '203.0.113.2'), ...visit(addDays(today, -9), '203.0.113.3'),
      // Records reaching back to the start of the week before, so it can be compared.
      { at: at(addDays(today, -13)), ip: '203.0.113.9', path: '/favicon.ico', type: 'image/x-icon' },
    ])
    const s = store.summary('7d', false, IDLE, local(at(today)))
    expect(s.daily).toHaveLength(7)
    expect(s.daily.at(-1)).toEqual({ day: local(at(today)), visitors: 1, views: 1 })
    expect(s.daily.reduce((n, d) => n + d.visitors, 0)).toBe(2)
    expect(s.previous).toEqual({ visitors: 1, views: 1 })
    expect(s.recordsFrom).toBeNull()
    // A month back reaches before the first record: no comparison, and the chart is told where records start.
    const m = store.summary('30d', false, IDLE, local(at(today)))
    expect(m.previous).toBeNull()
    expect(m.recordsFrom).toBe(local(at(addDays(today, -13))))
    expect(s.range).toEqual({ key: '7d', from: addDays(local(at(today)), -6), to: local(at(today)) })
  })

  it('keeps every request, however old, and the All range reaches back to the first', () => {
    const local = (iso: string): string => localDay(Date.parse(iso))
    add([...visit('2025-01-01', '203.0.113.1'), ...visit(today, '203.0.113.2')])
    const s = store.summary('all', false, IDLE, local(at(today)))
    expect(s.range.from).toBe(local(at('2025-01-01')))
    expect(s.daily).toHaveLength(dayCount(local(at('2025-01-01')), local(at(today))))
    expect(s.totals.visitors).toBe(2)
    expect(s.previous).toBeNull()
    expect(s.recordsFrom).toBeNull()
    // A year back no longer reaches the first visit, but it is still kept.
    expect(store.summary('1y', false, IDLE, local(at(today))).totals.visitors).toBe(1)
  })

  it('counts days from one date to another, both included', () => {
    expect(dayCount('2026-11-09', '2026-11-09')).toBe(1)
    expect(dayCount('2026-03-01', '2026-03-31')).toBe(31)
    expect(dayCount('2025-11-10', '2026-11-09')).toBe(365)
  })

  it('makes its salt once', () => {
    expect(store.salt()).toBe(store.salt())
    expect(store.salt()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('adds days across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

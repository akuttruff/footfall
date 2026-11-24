import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { RANGES } from '../src/types.ts'
import type { Count, DayCount, FetchStatus, RangeKey, Summary, Visit, VisitorClass } from '../src/types.ts'
import { hitKind, isAttackPath, localDay, normalizePath, parseAgent, referrerHost, visitorClass, visitorId } from './classify.ts'
import type { LogRow } from './logs.ts'


const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY, ua TEXT NOT NULL UNIQUE, browser TEXT NOT NULL, os TEXT NOT NULL, device TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hits (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, day TEXT NOT NULL, visitor TEXT NOT NULL,
  agent INTEGER NOT NULL REFERENCES agents(id), path TEXT NOT NULL, status INTEGER NOT NULL,
  kind TEXT NOT NULL, attack INTEGER NOT NULL, bot TEXT, ref_host TEXT
);
CREATE INDEX IF NOT EXISTS hits_day ON hits (day, kind);
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

/** Add days to a YYYY-MM-DD date. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDay(new Date(y, m - 1, d + n, 12).getTime())
}

/** Days from one YYYY-MM-DD to another, both counted. */
export function dayCount(from: string, to: string): number {
  const at = (d: string): number => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) }
  return Math.round((at(to) - at(from)) / 86_400_000) + 1
}

const top = (m: Map<string, number>, limit = 10): Count[] =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([key, n]) => ({ key, n }))

const bump = (m: Map<string, number>, key: string, by = 1): void => { m.set(key, (m.get(key) ?? 0) + by) }

interface VisitorRow {
  visitor: string
  day: string
  first: number
  pages: number
  assets: number
  probes: number
  attack: number
  bot: string | null
  browser: string
  os: string
  device: string
}

/**
 * Everything Footfall keeps, in one SQLite file: each request that says
 * something (redirects say nothing and are dropped), with the visitor as a
 * hash and the user agent kept once in `agents`; and the collector's state.
 * Addresses are never stored.
 */
export class Store {
  readonly db: DatabaseSync
  readonly file: string

  constructor(dir = path.resolve('.data')) {
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'footfall.sqlite')
    this.db = new DatabaseSync(this.file)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA busy_timeout = 2000')
    this.db.exec(SCHEMA)
  }

  close(): void { this.db.close() }

  // --- state --------------------------------------------------------------

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  set(key: string, value: string | null): void {
    if (value === null) this.db.prepare('DELETE FROM state WHERE key = ?').run(key)
    else this.db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  getNumber(key: string): number | null {
    const v = this.get(key)
    return v === null ? null : Number(v)
  }

  /** The secret mixed into each visitor's hash, made once; without it the hashes could be matched to addresses by trying them all. */
  salt(): string {
    let salt = this.get('salt')
    if (!salt) { salt = randomBytes(16).toString('hex'); this.set('salt', salt) }
    return salt
  }

  // --- requests -----------------------------------------------------------

  private agentId(ua: string, at: number): number {
    const known = this.db.prepare('SELECT id FROM agents WHERE ua = ?').get(ua) as { id: number } | undefined
    if (known) return known.id
    const a = parseAgent(ua === '' ? null : ua, at)
    return Number(this.db.prepare('INSERT INTO agents (ua, browser, os, device) VALUES (?, ?, ?, ?)').run(ua, a.browser, a.os, a.device).lastInsertRowid)
  }

  /** Keep each request not seen before; returns how many were new. */
  add(rows: LogRow[]): number {
    const salt = this.salt()
    const insert = this.db.prepare(`INSERT OR IGNORE INTO hits (id, ts, day, visitor, agent, path, status, kind, attack, bot, ref_host)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    let added = 0
    this.db.exec('BEGIN')
    try {
      for (const row of rows) {
        const kind = hitKind(row)
        if (kind === 'redirect') continue
        const day = localDay(row.ts)
        const ua = row.userAgent ?? ''
        const path = normalizePath(row.path)
        const r = insert.run(
          row.id, row.ts, day, visitorId(salt, row.ip, row.userAgent, day), this.agentId(ua, row.ts),
          path.slice(0, 300), row.status, kind, kind === 'probe' && isAttackPath(path) ? 1 : 0,
          parseAgent(row.userAgent, row.ts).bot, referrerHost(row.referrer, row.host),
        )
        added += Number(r.changes)
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return added
  }

  span(): { oldest: number | null; newest: number | null } {
    const r = this.db.prepare('SELECT MIN(ts) AS oldest, MAX(ts) AS newest FROM hits').get() as { oldest: number | null; newest: number | null }
    return { oldest: r.oldest, newest: r.newest }
  }

  // --- the summary --------------------------------------------------------

  private visitors(from: string, to: string): (VisitorRow & { cls: VisitorClass; why: string | null })[] {
    const rows = this.db.prepare(`
      SELECT h.visitor, MIN(h.day) AS day, MIN(h.ts) AS first,
        SUM(h.kind = 'page') AS pages, SUM(h.kind = 'asset') AS assets, SUM(h.kind = 'probe') AS probes,
        MAX(h.attack) AS attack, MAX(h.bot) AS bot, a.browser, a.os, a.device
      FROM hits h JOIN agents a ON a.id = h.agent
      WHERE h.day BETWEEN ? AND ?
      GROUP BY h.visitor`).all(from, to) as unknown as VisitorRow[]
    return rows.map((v) => ({ ...v, ...visitorClass({ pages: v.pages, assets: v.assets, probes: v.probes, attack: v.attack > 0, bot: v.bot }) }))
  }

  private pageHits(from: string, to: string): { ts: number; day: string; visitor: string; path: string; ref_host: string | null }[] {
    return this.db.prepare(`SELECT ts, day, visitor, path, ref_host FROM hits WHERE kind = 'page' AND day BETWEEN ? AND ? ORDER BY ts`)
      .all(from, to) as unknown as { ts: number; day: string; visitor: string; path: string; ref_host: string | null }[]
  }

  summary(key: RangeKey, includeUnconfirmed: boolean, fetch: Omit<FetchStatus, 'newestHit' | 'oldestHit'>, today = localDay(Date.now())): Summary {
    const span = this.span()
    const firstDay = span.oldest === null ? null : localDay(span.oldest)
    const from = key === 'all' ? (firstDay !== null && firstDay < today ? firstDay : today) : addDays(today, -(RANGES[key] - 1))
    const days = dayCount(from, today)
    const counted = (cls: VisitorClass): boolean => cls === 'person' || (includeUnconfirmed && cls === 'unconfirmed')

    const visitors = this.visitors(from, today)
    const hits = this.pageHits(from, today)

    const daily = new Map<string, DayCount>()
    for (let i = 0; i < days; i++) { const day = addDays(from, i); daily.set(day, { day, visitors: 0, views: 0 }) }
    const pages = new Map<string, number>()
    const referrers = new Map<string, number>()
    const devices = new Map<string, number>()
    const browsers = new Map<string, number>()
    const oses = new Map<string, number>()
    const reasons = new Map<string, number>()
    const visits = new Map<string, Visit>()
    let unconfirmed = 0
    let bots = 0

    for (const v of visitors) {
      if (v.cls === 'unconfirmed') unconfirmed++
      if (v.cls === 'bot') { bots++; bump(reasons, v.why ?? 'other') }
      if (!counted(v.cls)) continue
      const d = daily.get(v.day)
      if (d) d.visitors++
      bump(devices, v.device)
      bump(browsers, v.browser)
      bump(oses, v.os)
      visits.set(v.visitor, { at: v.first, cls: v.cls, pages: [], referrer: null, browser: v.browser, os: v.os, device: v.device })
    }
    let views = 0
    for (const h of hits) {
      const visit = visits.get(h.visitor)
      if (!visit) continue
      views++
      const d = daily.get(h.day)
      if (d) d.views++
      bump(pages, h.path)
      if (visit.pages.length === 0) visit.at = h.ts
      visit.pages.push(h.path)
      visit.referrer ??= h.ref_host
    }
    for (const v of visits.values()) bump(referrers, v.referrer ?? 'Direct or unknown')

    // The same span just before, for the change.
    const prevTo = addDays(from, -1)
    const prevFrom = addDays(prevTo, -(days - 1))
    // Only once records cover the whole span before; a part-recorded one would read as growth.
    let previous: Summary['previous'] = null
    if (key !== 'all' && firstDay !== null && firstDay <= prevFrom) {
      const prev = this.visitors(prevFrom, prevTo).filter((v) => counted(v.cls))
      const prevIds = new Set(prev.map((v) => v.visitor))
      previous = { visitors: prev.length, views: this.pageHits(prevFrom, prevTo).filter((h) => prevIds.has(h.visitor)).length }
    }

    const probes = this.db.prepare(`SELECT path AS key, COUNT(*) AS n FROM hits WHERE kind = 'probe' AND day BETWEEN ? AND ?
      GROUP BY path ORDER BY n DESC, path LIMIT 10`).all(from, today) as unknown as Count[]
    const requests = (this.db.prepare('SELECT COUNT(*) AS n FROM hits WHERE day BETWEEN ? AND ?').get(from, today) as { n: number }).n

    return {
      range: { key, from, to: today },
      includeUnconfirmed,
      totals: { visitors: visits.size, views, unconfirmed, bots, requests },
      previous,
      recordsFrom: firstDay !== null && firstDay > from ? firstDay : null,
      daily: [...daily.values()],
      pages: top(pages),
      referrers: top(referrers),
      devices: top(devices),
      browsers: top(browsers),
      os: top(oses),
      recent: [...visits.values()].sort((a, b) => b.at - a.at).slice(0, 30),
      bots: { reasons: top(reasons), probes },
      fetch: { ...fetch, newestHit: span.newest, oldestHit: span.oldest },
    }
  }
}

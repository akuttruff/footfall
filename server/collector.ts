import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseLog } from './logs.ts'
import type { LogRow } from './logs.ts'
import type { Store } from './store.ts'
import type { FetchStatus } from '../src/types.ts'

const run = promisify(execFile)

const HOUR = 3600_000
const DAY = 24 * HOUR

/** Amplify keeps about two weeks of logs; ask for a little less so the oldest window is never refused. */
export const HISTORY_MS = 13 * DAY
/** Requests can reach the logs a while after they happen, so each round looks back over this much again. */
export const OVERLAP_MS = 3 * HOUR
/** One request to Amplify covers at most this much (its limit is two weeks; a day keeps each file small). */
export const WINDOW_MS = DAY

export interface AmplifyConfig {
  appId: string
  domain: string
  profile: string
  /** The AWS CLI: credentials stay in ~/.aws, where the homepage's deploy already keeps them. */
  aws: string
}

/** The requests in one window of time, however they are got. */
export type LogSource = (start: number, end: number) => Promise<LogRow[]>

export function amplifyConfig(env = process.env): AmplifyConfig | null {
  const appId = env.FOOTFALL_APP_ID ?? env.AWS_AMPLIFY_APP_ID
  const domain = env.FOOTFALL_DOMAIN
  if (!appId || !domain) return null
  return {
    appId,
    domain,
    profile: env.FOOTFALL_PROFILE ?? env.AWS_AMPLIFY_PROFILE ?? env.AWS_PROFILE ?? 'default',
    aws: env.FOOTFALL_AWS ?? 'aws',
  }
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Asks Amplify for a signed link to the window's log file, then downloads and parses it. */
export function amplifySource(config: AmplifyConfig): LogSource {
  return async (start, end) => {
    const { stdout } = await run(config.aws, [
      'amplify', 'generate-access-logs',
      '--app-id', config.appId, '--domain-name', config.domain,
      '--start-time', iso(start), '--end-time', iso(end),
      '--profile', config.profile, '--output', 'json',
    ], { timeout: 60_000 })
    const { logUrl } = JSON.parse(stdout) as { logUrl?: string }
    if (!logUrl) throw new Error('Amplify gave no log link')
    const res = await fetch(logUrl, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`log download: HTTP ${res.status}`)
    return parseLog(await res.text())
  }
}

/** The windows still to fetch: from where the last round got to (less the overlap), a day at a time, up to now. */
export function windows(cursor: number | null, now: number): [number, number][] {
  const earliest = now - HISTORY_MS
  let start = Math.max(cursor === null ? earliest : cursor - OVERLAP_MS, earliest)
  const out: [number, number][] = []
  while (start < now) {
    const end = Math.min(start + WINDOW_MS, now)
    out.push([start, end])
    start = end
  }
  return out
}

function oneLine(err: unknown): string {
  const e = err as { stderr?: string; message?: string }
  const text = (e.stderr?.trim() || e.message || String(err)).split('\n').filter(Boolean)
  return (text.at(-1) ?? 'failed').slice(0, 300)
}

/**
 * Brings the store up to date with Amplify's logs: on first run the last
 * thirteen days, then every hour whatever is new. A round that fails keeps
 * what it got up to the failure and tries again on the next.
 */
export class Collector {
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<number> | null = null
  private readonly store: Store
  private readonly source: LogSource | null
  private readonly intervalMs: number

  constructor(store: Store, source: LogSource | null, intervalMs = HOUR) {
    this.store = store
    this.source = source
    this.intervalMs = intervalMs
  }

  start(): void {
    if (this.timer) return
    void this.fetch()
    this.timer = setInterval(() => { void this.fetch() }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  get running(): boolean { return this.inFlight !== null }

  status(): Omit<FetchStatus, 'newestHit' | 'oldestHit'> {
    return {
      lastRunAt: this.store.getNumber('lastRunAt'),
      lastOkAt: this.store.getNumber('lastOkAt'),
      lastError: this.source ? this.store.get('lastError') : 'No Amplify app is set (FOOTFALL_APP_ID or AWS_AMPLIFY_APP_ID)',
      running: this.running,
      gaps: this.gaps(),
    }
  }

  gaps(): { from: number; to: number }[] {
    try { return JSON.parse(this.store.get('gaps') ?? '[]') as { from: number; to: number }[] } catch { return [] }
  }

  private addGap(from: number, to: number): void {
    this.store.set('gaps', JSON.stringify([...this.gaps(), { from, to }]))
  }

  /** One round; a second call while one is running joins it. Resolves to the number of new requests. */
  fetch(now = Date.now()): Promise<number> {
    this.inFlight ??= this.round(now).finally(() => { this.inFlight = null })
    return this.inFlight
  }

  private async round(now: number): Promise<number> {
    if (!this.source) return 0
    this.store.set('lastRunAt', String(now))
    let added = 0
    try {
      const cursor = this.store.getNumber('cursor')
      const plan = windows(cursor, now)
      // Away longer than Amplify keeps logs: what fell out of its window is gone for good, so say where.
      if (cursor !== null && plan.length > 0 && plan[0][0] > cursor) this.addGap(cursor, plan[0][0])
      for (const [start, end] of plan) {
        added += this.store.add(await this.source(start, end))
        this.store.set('cursor', String(end))
      }
      this.store.set('lastOkAt', String(now))
      this.store.set('lastError', null)
    } catch (err) {
      this.store.set('lastError', oneLine(err))
      console.error(`[footfall] fetch failed: ${oneLine(err)}`)
    }
    return added
  }
}

/** What the server sends the page; shared by both. */

/** Days in each range; `all` (0) runs from the first record to today. */
export const RANGES = { '7d': 7, '30d': 30, '90d': 90, '1y': 365, all: 0 } as const
export type RangeKey = keyof typeof RANGES

export interface Count {
  key: string
  n: number
}

export interface DayCount {
  /** YYYY-MM-DD, local. */
  day: string
  visitors: number
  views: number
}

export type VisitorClass = 'person' | 'unconfirmed' | 'bot'

export interface Visit {
  /** Epoch ms of the first page. */
  at: number
  cls: VisitorClass
  /** Every page, in order, repeats included. */
  pages: string[]
  referrer: string | null
  browser: string
  os: string
  device: string
}

export interface FetchStatus {
  /** When the collector last asked Amplify, and when it last succeeded. */
  lastRunAt: number | null
  lastOkAt: number | null
  lastError: string | null
  /** The newest request time it has, so the page can say how current it is. */
  newestHit: number | null
  oldestHit: number | null
  running: boolean
  /** Spans that could not be fetched because the Mac was away longer than Amplify keeps logs. */
  gaps: { from: number; to: number }[]
}

export interface Summary {
  /** The site whose logs these are (FOOTFALL_DOMAIN), when configured. */
  site?: string | null
  range: { key: RangeKey; from: string; to: string }
  includeUnconfirmed: boolean
  totals: { visitors: number; views: number; unconfirmed: number; bots: number; requests: number }
  /** The same span just before; null until records reach back that far. */
  previous: { visitors: number; views: number } | null
  /** The first day with records, when it falls inside the range. */
  recordsFrom: string | null
  daily: DayCount[]
  pages: Count[]
  referrers: Count[]
  devices: Count[]
  browsers: Count[]
  os: Count[]
  recent: Visit[]
  bots: { reasons: Count[]; probes: Count[] }
  fetch: FetchStatus
}

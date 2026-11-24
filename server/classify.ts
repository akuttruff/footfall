import { createHash } from 'node:crypto'
import type { LogRow } from './logs.ts'

/**
 * What one request was, and what the user agent behind it says.
 *
 * Most of what reaches the homepage is not people. Search and SEO crawlers
 * name themselves; vulnerability scanners do not. Scanners pose as browsers,
 * often years-old ones, and ask for paths the site never had (`/.env`,
 * `/wp-login.php`). So a request is judged by its path as well as its user
 * agent, and a visitor (see `visitorClass`) by everything it asked for that day.
 */

/** The homepage's routes (`homepage/src/components/app.tsx`). */
export const ROUTES = ['/', '/work', '/projects', '/talks', '/music', '/writing'] as const

/** A page: one of the routes, served. */
export type HitKind = 'page' | 'asset' | 'probe' | 'redirect' | 'other'

export interface Agent {
  browser: string
  os: string
  device: 'phone' | 'tablet' | 'desktop' | 'unknown'
  /** Why this user agent is not a person's browser, or null when it could be one. */
  bot: string | null
}

/** Files every visit may fetch besides the page: the built bundle, fonts, images and the browser's own asks. */
const ASSET = /^\/(static|fonts|assets)\/|\.(js|css|woff2?|ttf|png|jpe?g|gif|webp|avif|svg|ico|map|json|txt|webmanifest|xml)$/i

export function normalizePath(path: string): string {
  const p = path.replace(/\/{2,}/g, '/')
  if (p === '/index.html') return '/'
  return p.length > 1 ? p.replace(/\/+$/, '') : p
}

export function hitKind(row: Pick<LogRow, 'method' | 'path' | 'status'>): HitKind {
  if (row.status >= 300 && row.status < 400 && row.status !== 304) return 'redirect'
  const path = normalizePath(row.path)
  const ok = row.status === 200 || row.status === 304
  if ((ROUTES as readonly string[]).includes(path)) return ok && row.method === 'GET' ? 'page' : 'other'
  if (ASSET.test(path)) return ok ? 'asset' : 'other'
  // Anything else is a path the site never had: someone looking for a way in.
  return 'probe'
}

// --- user agents ------------------------------------------------------------

const BOT_WORDS = /bot\b|bot\/|crawl|spider|slurp|scrapy|curl|wget|python|go-http|java\/|httpclient|okhttp|axios|node-fetch|undici|headless|phantom|lighthouse|pingdom|uptime|monitor|check|scan|preview|fetcher|facebookexternalhit|embedly|whatsapp|telegram|discord|skype|archive/i

/**
 * Browsers update themselves every four weeks; a user agent a year or more
 * behind is almost always a script wearing it. The expected version is worked
 * out from the date, so the cut-off keeps moving without anyone touching it.
 */
export function expectedMajor(browser: 'chrome' | 'firefox', at: number): number {
  // Chrome 131 and Firefox 133 shipped in late November 2024; both release every 28 days.
  const [base, since] = browser === 'chrome' ? [131, Date.UTC(2024, 10, 12)] : [133, Date.UTC(2024, 10, 26)]
  return base + Math.floor((at - since) / (28 * 86_400_000))
}

/** How far behind (in releases, about a year) a browser may be before it reads as a script. */
const STALE_RELEASES = 13

function major(ua: string, re: RegExp): number | null {
  const m = re.exec(ua)
  return m ? Number(m[1]) : null
}

export function parseAgent(ua: string | null, at: number): Agent {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', device: 'unknown', bot: 'no user agent' }

  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Other'
  const device: Agent['device'] = /iPad|Tablet/.test(ua) || (os === 'Android' && !/Mobile/.test(ua)) ? 'tablet'
    : /iPhone|iPod|Mobi|Android/.test(ua) ? 'phone'
    : os === 'Other' ? 'unknown' : 'desktop'
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : /Safari\//.test(ua) && os === 'iOS' ? 'Safari (in app)'
    : 'Other'

  const bot = ((): string | null => {
    // Crawlers name themselves, often with a page about them: "(+https://…)".
    if (BOT_WORDS.test(ua) || /\+https?:/.test(ua)) return 'crawler'
    if (!ua.startsWith('Mozilla/5.0')) return 'not a browser'
    if (/compatible;|Trident\/|MSIE /.test(ua)) return 'not a browser'
    // PetalBot and others: a browser string with the K of KHTML missing.
    if (/\(HTML like Gecko\)/.test(ua)) return 'not a browser'
    // Real browsers always name the engine after the platform.
    if (!/AppleWebKit|Gecko\//.test(ua)) return 'not a browser'
    // …and a WebKit browser then names itself (Chrome/, Version/, or an in-app Mobile/ build).
    if (/AppleWebKit/.test(ua) && !/Chrome\/|CriOS|FxiOS|Edg|Version\/|Mobile\//.test(ua)) return 'not a browser'
    if (/Windows NT [5-6]\./.test(ua)) return 'stale browser'
    const ios = major(ua, /OS (\d+)_\d+(?:_\d+)? like Mac OS X/)
    if (ios !== null && ios < 15) return 'stale browser'
    const chrome = major(ua, /(?:Chrome|CriOS)\/(\d+)\./)
    if (chrome !== null && chrome < expectedMajor('chrome', at) - STALE_RELEASES) return 'stale browser'
    const firefox = major(ua, /Firefox\/(\d+)\./)
    if (firefox !== null && firefox < expectedMajor('firefox', at) - STALE_RELEASES) return 'stale browser'
    return null
  })()

  return { browser, os, device, bot }
}

// --- visitors ---------------------------------------------------------------

/** The local calendar day (YYYY-MM-DD) a time falls on, in the Mac's time zone. */
export function localDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * One visitor on one day: a salted hash of the address, the user agent and
 * the day. Only the hash is kept, never the address, and since the day is in
 * it, the same person on two days is two unrelated visitors.
 */
export function visitorId(salt: string, ip: string, ua: string | null, day: string): string {
  return createHash('sha256').update(`${salt}|${ip}|${ua ?? ''}|${day}`).digest('hex').slice(0, 16)
}

const bare = (host: string): string => host.toLowerCase().replace(/^www\./, '')

/** Where a visit came from: the referring site's host, or null for none or the site itself (`self`, with or without www). */
export function referrerHost(referrer: string | null, self = ''): string | null {
  if (!referrer) return null
  try {
    const host = new URL(referrer).hostname.toLowerCase()
    if (!host || (self && bare(host) === bare(self))) return null
    return host.replace(/^www\./, '')
  } catch {
    return null
  }
}

export type VisitorClass = 'person' | 'unconfirmed' | 'bot'

export interface VisitorFacts {
  pages: number
  assets: number
  /** Paths the site never had. */
  probes: number
  /** Whether any of them is unmistakably an attack (see `isAttackPath`). */
  attack: boolean
  bot: string | null
}

/** Paths only an attacker asks for: config and secrets, admin panels of other software, scripts. */
const ATTACK = /(^|\/)\.[a-z]|\.(php|aspx?|jsp|cgi|env|ini|bak|sql|ya?ml|conf|git)(\/|$)|wp-|xmlrpc|phpmyadmin|cgi-bin|\/etc\/|\.\.\//i

export function isAttackPath(path: string): boolean {
  return ATTACK.test(path)
}

/**
 * A visitor-day is a person when its browser looks real, it did not go
 * looking for paths the site never had, and it fetched the page's code or pictures (a
 * script that reads the HTML and stops does not). A real browser that
 * fetched nothing more is "unconfirmed": a returning visitor with everything
 * cached looks like that, and so does a careful scanner.
 */
export function visitorClass(v: VisitorFacts): { cls: VisitorClass; why: string | null } {
  if (v.bot) return { cls: 'bot', why: v.bot }
  // One unknown path is a typo or an old link; a run of them, or one that
  // only an attacker asks for, is a scanner.
  if (v.attack || v.probes >= 2) return { cls: 'bot', why: 'probed for weak spots' }
  if (v.pages === 0) return { cls: 'bot', why: 'no page' }
  return { cls: v.assets > 0 ? 'person' : 'unconfirmed', why: null }
}

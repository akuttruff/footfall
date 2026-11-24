// Fills .data-demo with a month of made-up traffic for example.com, for
// trying the page (and taking screenshots) without any real logs:
//
//   npm run demo:data && npm run demo
//
// Addresses come from the documentation ranges (RFC 5737); pages, referrers
// and visitors are invented. A fixed seed makes every run the same.
import fs from 'node:fs'
import path from 'node:path'
import { UA, logText } from '../server/fixtures.ts'
import type { Req } from '../server/fixtures.ts'
import { parseLog } from '../server/logs.ts'
import { Store } from '../server/store.ts'

const DIR = path.resolve(process.env.FOOTFALL_DATA ?? '.data-demo')
const DAYS = 30
const DAY = 86_400_000

let seed = 20261124
const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const pick = <T,>(xs: readonly (readonly [T, number])[]): T => {
  let r = rand() * xs.reduce((s, [, w]) => s + w, 0)
  for (const [x, w] of xs) if ((r -= w) < 0) return x
  return xs[0][0]
}

// Only the paths in ROUTES count as pages; anything else is a probe.
const PAGES = [['/', 10], ['/projects', 5], ['/writing', 4], ['/work', 3], ['/talks', 2], ['/music', 1]] as const
const REFERRERS = [[undefined, 10], ['https://www.google.com/', 6], ['https://www.linkedin.com/', 3], ['https://github.com/', 3], ['https://duckduckgo.com/', 1], ['https://news.ycombinator.com/', 1]] as const
const BROWSERS = [
  [UA.iphone, 6], [UA.mac, 3], [UA.chrome, 4],
  ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36', 2],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML like Gecko) Version/27.0 Safari/605.1.15', 3],
] as const
const CRAWLERS = [[UA.ahrefs, 3], [UA.petal, 2], ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 4], ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)', 2], ['python-requests/2.32.3', 1]] as const
const PROBES = [['/.env', 5], ['/wp-login.php', 4], ['/.git/config', 3], ['/wp-admin/setup-config.php', 2], ['/phpmyadmin/', 1], ['/login', 2]] as const
const NETS = ['192.0.2', '198.51.100', '203.0.113']

const ip = (): string => `${NETS[Math.floor(rand() * 3)]}.${1 + Math.floor(rand() * 254)}`
const iso = (ms: number): string => new Date(ms).toISOString()

const reqs: Req[] = []
const now = Date.now()
for (let d = DAYS - 1; d >= 0; d--) {
  const dayStart = now - d * DAY - (d === 0 ? 0 : rand() * DAY / 2)
  const weekend = [0, 6].includes(new Date(dayStart).getDay())
  const people = Math.round((weekend ? 3 : 7) + rand() * 6 + (d === 12 ? 18 : 0)) // one day a post was shared
  for (let p = 0; p < people; p++) {
    let t = dayStart - rand() * DAY * (d === 0 ? 0.5 : 1)
    const who = { ip: ip(), ua: pick(BROWSERS) }
    const cached = rand() < 0.2 // a returning browser that already has the code
    const referrer = pick(d === 12 && rand() < 0.7 ? [['https://news.ycombinator.com/', 1]] as const : REFERRERS)
    let page = ''
    for (let v = 0, views = 1 + Math.floor(rand() * rand() * 3); v < views; v++, t += 30_000 + rand() * 120_000) {
      page = pick(PAGES.filter(([p]) => p !== page))
      reqs.push({ at: iso(t), ...who, path: page, referrer: v === 0 ? referrer : 'https://www.example.com/' })
      if (cached && v === 0) continue
      reqs.push({ at: iso(t + 300), ...who, path: '/static/index-4f2a.js', type: 'text/javascript', referrer: 'https://www.example.com/' })
      reqs.push({ at: iso(t + 400), ...who, path: '/static/index-9c1e.css', type: 'text/css', referrer: 'https://www.example.com/' })
    }
  }
  for (let b = 0, bots = 25 + Math.floor(rand() * 30); b < bots; b++) {
    const t = dayStart - rand() * DAY
    if (rand() < 0.6) reqs.push({ at: iso(t), ip: ip(), ua: pick(CRAWLERS), path: pick(PAGES) })
    else reqs.push({ at: iso(t), ip: ip(), ua: UA.oldChrome, path: pick(PROBES), status: 404 })
  }
}

fs.rmSync(DIR, { recursive: true, force: true })
const store = new Store(DIR)
const added = store.add(parseLog(logText(reqs.filter((r) => Date.parse(r.at) <= now))))
store.set('lastRunAt', String(now - 12 * 60_000))
store.set('lastOkAt', String(now - 12 * 60_000))
store.close()
console.log(`demo: ${added} made-up requests in ${path.relative(process.cwd(), DIR)}`)

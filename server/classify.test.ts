// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { expectedMajor, hitKind, isAttackPath, normalizePath, parseAgent, referrerHost, visitorClass, visitorId } from './classify.ts'
import { UA } from './fixtures.ts'
import { parseLog, splitRow } from './logs.ts'
import { logText } from './fixtures.ts'

const NOV_2026 = Date.UTC(2026, 10, 9)

describe('parseLog', () => {
  it('reads each row, unescaping fields and decoding the user agent', () => {
    const [row] = parseLog(logText([{ at: '2026-11-09T08:09:16Z', path: '/projects', referrer: 'https://www.google.com/', ua: UA.chrome, id: 'abc' }]))
    expect(row).toMatchObject({
      id: 'abcabc==', ts: Date.parse('2026-11-09T08:09:16Z'), ip: '203.0.113.10', method: 'GET',
      host: 'www.example.com', path: '/projects', status: 200, referrer: 'https://www.google.com/',
      userAgent: UA.chrome, contentType: 'text/html',
    })
  })

  it('treats a dash as nothing and skips rows it cannot read', () => {
    const text = logText([{ at: '2026-11-09T08:00:00Z', ua: null }]) + 'garbage\n'
    const rows = parseLog(text)
    expect(rows).toHaveLength(1)
    expect(rows[0].userAgent).toBeNull()
    expect(rows[0].referrer).toBeNull()
  })

  it('refuses a file that is not an access log', () => {
    expect(() => parseLog('<Error>AccessDenied</Error>')).toThrow(/Unexpected log header/)
  })

  it('splits only on unescaped commas', () => {
    expect(splitRow('a\\,b,c\\(d)')).toEqual(['a,b', 'c(d)'])
  })
})

describe('hitKind', () => {
  it('tells pages, assets, redirects and probes apart', () => {
    expect(hitKind({ method: 'GET', path: '/', status: 200 })).toBe('page')
    expect(hitKind({ method: 'GET', path: '/talks/', status: 304 })).toBe('page')
    expect(hitKind({ method: 'GET', path: '/index.html', status: 200 })).toBe('page')
    expect(hitKind({ method: 'HEAD', path: '/', status: 200 })).toBe('other')
    expect(hitKind({ method: 'GET', path: '/', status: 302 })).toBe('redirect')
    expect(hitKind({ method: 'GET', path: '/static/index-BmLCB-UN.js', status: 200 })).toBe('asset')
    expect(hitKind({ method: 'GET', path: '/favicon.ico', status: 200 })).toBe('asset')
    expect(hitKind({ method: 'GET', path: '/.env', status: 200 })).toBe('probe')
    expect(hitKind({ method: 'GET', path: '/login', status: 200 })).toBe('probe')
  })

  it('normalizes paths', () => {
    expect(normalizePath('//projects/')).toBe('/projects')
    expect(normalizePath('/')).toBe('/')
  })

  it('knows the paths only attackers ask for', () => {
    for (const p of ['/.env', '/.git/config', '/wp-login.php', '/xmlrpc.php', '/phpmyadmin', '/config.yml']) expect(isAttackPath(p)).toBe(true)
    for (const p of ['/login', '/resume', '/contact']) expect(isAttackPath(p)).toBe(false)
  })
})

describe('parseAgent', () => {
  it('reads browser, system and device', () => {
    expect(parseAgent(UA.mac, NOV_2026)).toEqual({ browser: 'Firefox', os: 'macOS', device: 'desktop', bot: null })
    expect(parseAgent(UA.iphone, NOV_2026)).toEqual({ browser: 'Safari', os: 'iOS', device: 'phone', bot: null })
    expect(parseAgent(UA.chrome, NOV_2026)).toMatchObject({ browser: 'Chrome', os: 'Windows', bot: null })
  })

  it('names crawlers and things that are not browsers', () => {
    expect(parseAgent(UA.ahrefs, NOV_2026).bot).toBe('crawler')
    expect(parseAgent(UA.petal, NOV_2026).bot).toBe('crawler')
    expect(parseAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML like Gecko) Chrome/154.0.0.0 Safari/537.36 ForestEngine/1.0 (+https://forestengine.ai)', NOV_2026).bot).toBe('crawler')
    expect(parseAgent('Mozilla/5.0 (compatible; domain-list-check/1.0)', NOV_2026).bot).toBe('crawler')
    expect(parseAgent('python-requests/2.31', NOV_2026).bot).toBe('crawler')
    expect(parseAgent('Go-http-client/1.1', NOV_2026).bot).toBe('crawler')
    expect(parseAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', NOV_2026).bot).toBe('not a browser')
    expect(parseAgent('Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko', NOV_2026).bot).toBe('not a browser')
    expect(parseAgent(null, NOV_2026).bot).toBe('no user agent')
  })

  it('takes a browser a year or more out of date for a script', () => {
    expect(parseAgent(UA.oldChrome, NOV_2026).bot).toBe('stale browser')
    expect(parseAgent(UA.oldIphone, NOV_2026).bot).toBe('stale browser')
    expect(parseAgent('Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML like Gecko) Chrome/156.0 Safari/537.36', NOV_2026).bot).toBe('stale browser')
    // Chrome 145 is about ten months old in November 2026: still a person's.
    expect(parseAgent(UA.chrome.replace('156', '145'), NOV_2026).bot).toBeNull()
  })

  it('moves the cut-off with the calendar', () => {
    expect(expectedMajor('chrome', NOV_2026)).toBe(156)
    expect(expectedMajor('chrome', Date.UTC(2027, 10, 9))).toBeGreaterThan(165)
  })
})

describe('visitors', () => {
  it('hashes address, agent and day, so the same person on two days is two visitors', () => {
    const a = visitorId('s', '203.0.113.1', UA.mac, '2026-11-09')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(visitorId('s', '203.0.113.1', UA.mac, '2026-11-09')).toBe(a)
    expect(visitorId('s', '203.0.113.1', UA.mac, '2026-11-10')).not.toBe(a)
    expect(visitorId('t', '203.0.113.1', UA.mac, '2026-11-09')).not.toBe(a)
  })

  it('keeps only the referring host, and not the homepage itself', () => {
    expect(referrerHost('https://www.google.com/')).toBe('google.com')
    expect(referrerHost('https://l.instagram.com/?u=x')).toBe('l.instagram.com')
    expect(referrerHost('https://example.com/projects', 'www.example.com')).toBeNull()
    expect(referrerHost('https://www.example.com/', 'example.com')).toBeNull()
    expect(referrerHost('not a url')).toBeNull()
    expect(referrerHost(null)).toBeNull()
  })

  it('classes a visitor-day by everything it did', () => {
    const base = { pages: 1, assets: 1, probes: 0, attack: false, bot: null }
    expect(visitorClass(base).cls).toBe('person')
    expect(visitorClass({ ...base, assets: 0 }).cls).toBe('unconfirmed')
    expect(visitorClass({ ...base, bot: 'crawler' })).toEqual({ cls: 'bot', why: 'crawler' })
    // One unknown path is a typo; two, or one only an attacker asks for, is a scanner.
    expect(visitorClass({ ...base, probes: 1 }).cls).toBe('person')
    expect(visitorClass({ ...base, probes: 2 }).why).toBe('probed for weak spots')
    expect(visitorClass({ ...base, probes: 1, attack: true }).cls).toBe('bot')
    expect(visitorClass({ ...base, pages: 0 }).why).toBe('no page')
  })
})

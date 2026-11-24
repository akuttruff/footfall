/** Amplify access-log text for tests, in the exact shape Amplify sends (header escaping and all). */

export const HEADER = 'date,time,x-edge-location,sc-bytes,c-ip,cs-method,cs\\(Host),cs-uri-stem,sc-status,cs\\(Referer),cs\\(User-Agent),cs-uri-query,cs\\(Cookie),x-edge-result-type,x-edge-request-id,x-host-header,cs-protocol,cs-bytes,time-taken,x-forwarded-for,ssl-protocol,ssl-cipher,x-edge-response-result-type,cs-protocol-version,fle-status,fle-encrypted-fields,c-port,time-to-first-byte,x-edge-detailed-result-type,sc-content-type,sc-content-len,sc-range-start,sc-range-end'

export const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
  oldChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML like Gecko) Chrome/79.0.3945.88 Safari/537.36',
  oldIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML like Gecko) Chrome/156.0.0.0 Safari/537.36',
  ahrefs: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  petal: 'Mozilla/5.0 (Linux; Android 7.0;) AppleWebKit/537.36 (HTML like Gecko) Mobile Safari/537.36 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
}

export interface Req {
  at: string // ISO, UTC
  ip?: string
  path?: string
  status?: number
  referrer?: string
  ua?: string | null
  id?: string
  host?: string
  type?: string
}

let n = 0

/** One log line, encoded the way Amplify encodes it. */
export function line(r: Req): string {
  const [date, time] = r.at.replace('Z', '').split('T')
  const enc = (s: string): string => encodeURIComponent(s).replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%3B/g, ';').replace(/\(/g, '\\(').replace(/\)/g, ')')
  const ua = r.ua === null ? '-' : enc(r.ua ?? UA.mac)
  const f: string[] = Array.from({ length: 33 }, () => '-')
  f[0] = date; f[1] = time.slice(0, 8); f[2] = 'SEA19-C1'; f[3] = '1000'; f[4] = r.ip ?? '203.0.113.10'; f[5] = 'GET'
  f[6] = 'd111111abcdef8.cloudfront.net'; f[7] = r.path ?? '/'; f[8] = String(r.status ?? 200)
  f[9] = r.referrer ?? '-'; f[10] = ua; f[13] = 'Hit'; f[14] = (r.id ?? `req${++n}`) + 'abc\\=\\='
  f[15] = r.host ?? 'www.example.com'; f[16] = 'https'; f[29] = r.type ?? 'text/html'
  return f.join(',')
}

export const logText = (reqs: Req[]): string => [HEADER, ...reqs.map(line)].join('\n') + '\n'

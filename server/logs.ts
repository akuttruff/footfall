/**
 * Amplify Hosting's access logs: CloudFront's standard log format as CSV,
 * one header row, then one row per request. Commas never appear inside a
 * field (CloudFront drops them from user agents), but a literal `(`, `)`,
 * `=` or `,` may arrive escaped with a backslash, and the user agent and
 * referrer are URL-encoded.
 */

export interface LogRow {
  /** CloudFront's own id for the request: unique, so a re-fetched window adds nothing twice. */
  id: string
  /** Epoch ms, from the row's UTC date and time. */
  ts: number
  ip: string
  method: string
  /** The host the visitor asked for (example.com or www.example.com). */
  host: string
  path: string
  status: number
  referrer: string | null
  userAgent: string | null
  contentType: string | null
}

/** Split on commas that are not escaped. */
export function splitRow(line: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '\\' && i + 1 < line.length) { cur += line[++i]; continue }
    if (c === ',') { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out
}

const dash = (v: string | undefined): string | null => (v === undefined || v === '-' || v === '' ? null : v)

function decode(v: string | null): string | null {
  if (v === null) return null
  try { return decodeURIComponent(v) } catch { return v }
}

/** Every request in one downloaded log file. Rows that do not parse are skipped. */
export function parseLog(text: string): LogRow[] {
  const lines = text.split('\n')
  const header = splitRow(lines[0]?.trim() ?? '')
  const col = (name: string): number => header.indexOf(name)
  const at = {
    date: col('date'), time: col('time'), ip: col('c-ip'), method: col('cs-method'),
    path: col('cs-uri-stem'), status: col('sc-status'), referrer: col('cs(Referer)'),
    ua: col('cs(User-Agent)'), id: col('x-edge-request-id'), host: col('x-host-header'),
    type: col('sc-content-type'), forwarded: col('x-forwarded-for'),
  }
  if (at.date < 0 || at.id < 0 || at.path < 0) throw new Error(`Unexpected log header: ${lines[0]?.slice(0, 120) ?? '(empty)'}`)

  const rows: LogRow[] = []
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/\r$/, '')
    if (!line) continue
    const f = splitRow(line)
    const ts = Date.parse(`${f[at.date]}T${f[at.time]}Z`)
    const id = f[at.id]
    if (!id || !Number.isFinite(ts)) continue
    // Behind a proxy the visitor is the first address it forwarded for.
    const forwarded = dash(f[at.forwarded])?.split(/[ ,]/)[0]
    rows.push({
      id,
      ts,
      ip: forwarded || f[at.ip] || '',
      method: f[at.method] ?? '',
      host: (f[at.host] ?? '').toLowerCase(),
      path: decode(f[at.path] ?? '/') ?? '/',
      status: Number(f[at.status]) || 0,
      referrer: decode(dash(f[at.referrer])),
      userAgent: decode(dash(f[at.ua])),
      contentType: dash(f[at.type]),
    })
  }
  return rows
}

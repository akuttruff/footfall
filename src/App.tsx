import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import DailyChart from './components/DailyChart.tsx'
import { ago, change, dayLabel, pageName, plural, when } from './lib/format.ts'
import { RANGES } from './types.ts'
import type { Count, RangeKey, Summary } from './types.ts'

const remembered = <T extends string>(key: string, fallback: T, ok: (v: string) => boolean): T => {
  try { const v = localStorage.getItem(key); return v !== null && ok(v) ? (v as T) : fallback } catch { return fallback }
}
const remember = (key: string, value: string): void => { try { localStorage.setItem(key, value) } catch { /* private window */ } }

/** A ranked list as thin bars, longest first. */
function Ranked({ title, rows, label = (k) => k, unit }: { title: string; rows: Count[]; label?: (k: string) => string; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="dim">None yet</p> : (
        <ul className="ranked" aria-label={title}>
          {rows.map((r) => (
            <li key={r.key}>
              <span className="ranked-label">{label(r.key)}</span>
              <span className="ranked-n num" aria-label={plural(r.n, unit)}>{r.n.toLocaleString()}</span>
              <span className="ranked-bar" style={{ width: `${(r.n / max) * 100}%` }} aria-hidden="true" />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Tile({ label, value, delta, note }: { label: string; value: string; delta?: string | null; note?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value num">{value}</div>
      <div className="tile-note">
        {delta && <span className="delta">{delta}</span>}
        {note && <span className="dim"> {note}</span>}
      </div>
    </div>
  )
}

const DEVICE: Record<string, string> = { phone: 'Phone', tablet: 'Tablet', desktop: 'Computer', unknown: 'Unknown' }

export default function App() {
  const [range, setRange] = useState<RangeKey>(() => remembered('range', '30d', (v) => v in RANGES))
  const [unconfirmed, setUnconfirmed] = useState(() => remembered<string>('unconfirmed', '0', () => true) === '1')
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/summary?range=${range}&unconfirmed=${unconfirmed ? 1 : 0}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json() as Summary)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [range, unconfirmed])

  useEffect(() => {
    void load()
    const t = setInterval(() => { void load() }, 5 * 60_000)
    const onFocus = (): void => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onFocus)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onFocus) }
  }, [load])

  const refresh = async (): Promise<void> => {
    setFetching(true)
    try { await fetch('/api/fetch', { method: 'POST' }) } catch { /* the summary says what happened */ }
    await load()
    setFetching(false)
  }

  const pick = (r: RangeKey): void => { setRange(r); remember('range', r) }
  const toggle = (): void => { setUnconfirmed(!unconfirmed); remember('unconfirmed', unconfirmed ? '0' : '1') }

  const f = data?.fetch
  const t = data?.totals
  const busy = fetching || f?.running

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <h1>Footfall</h1>
          {data?.site && <span className="topbar-sub">{data.site}</span>}
        </div>
        <div className="topbar-tools">
          <div className="range" role="group" aria-label="Range">
            {(Object.keys(RANGES) as RangeKey[]).map((r) => (
              <button key={r} type="button" className={r === range ? 'on' : ''} aria-pressed={r === range} onClick={() => pick(r)}>{r === 'all' ? 'All' : r}</button>
            ))}
          </div>
          <button type="button" className={`icon-btn${busy ? ' spinning' : ''}`} aria-label="Fetch new visits now" disabled={!!busy} onClick={() => void refresh()}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="dash">
        {error && !data && <p className="error-card" role="alert">Couldn&apos;t load the numbers: {error}</p>}
        {f?.lastError && <p className="error-card" role="alert">The last fetch from Amplify failed: {f.lastError}</p>}
        {f && f.gaps.length > 0 && (
          <p className="error-card">
            Missing from the records, because Footfall was off longer than Amplify keeps its logs:{' '}
            {f.gaps.map((g) => `${when(g.from)} to ${when(g.to)}`).join('; ')}.
          </p>
        )}

        {data && t && (
          <>
            <section className="tiles" aria-label="Totals">
              <Tile
                label="Visitors" value={t.visitors.toLocaleString()}
                delta={data.previous && change(t.visitors, data.previous.visitors)}
                note={data.previous ? `vs the ${range} before` : range === 'all' ? `since ${dayLabel(data.range.from, false)}` : data.recordsFrom ? `since ${dayLabel(data.recordsFrom, false)}` : undefined}
              />
              <Tile label="Page views" value={t.views.toLocaleString()} delta={data.previous && change(t.views, data.previous.views)} />
              <Tile label="Pages a visit" value={t.visitors ? (t.views / t.visitors).toFixed(1) : '—'} />
              <Tile label="Bots and scanners" value={t.bots.toLocaleString()} note={`of ${plural(t.requests, 'request')}`} />
            </section>

            <section className="card wide">
              <div className="card-head">
                <h2>Visitors a day</h2>
                <label className="switch">
                  <input type="checkbox" checked={unconfirmed} onChange={toggle} />
                  <span>Count unconfirmed ({t.unconfirmed.toLocaleString()})</span>
                </label>
              </div>
              <DailyChart days={data.daily} recordsFrom={data.recordsFrom} />
            </section>

            <Ranked title="Pages" rows={data.pages} label={pageName} unit="view" />
            <Ranked title="Came from" rows={data.referrers} unit="visitor" />
            <Ranked title="Devices" rows={data.devices} label={(k) => DEVICE[k] ?? k} unit="visitor" />
            <Ranked title="Browsers" rows={data.browsers} unit="visitor" />
            <Ranked title="Systems" rows={data.os} unit="visitor" />

            <section className="card wide">
              <h2>Recent visits</h2>
              {data.recent.length === 0 ? <p className="dim">No visits in this range yet</p> : (
                <ul className="visits">
                  {data.recent.map((v) => (
                    <li key={`${v.at}-${v.pages.join()}`}>
                      <span className="visit-when num">{when(v.at)}</span>
                      <span className="visit-pages">{v.pages.map(pageName).join(' → ')}</span>
                      <span className="visit-who dim">
                        {DEVICE[v.device] ?? v.device} · {v.browser} on {v.os}
                        {v.referrer && <> · from {v.referrer}</>}
                        {v.cls === 'unconfirmed' && <span className="tag">unconfirmed</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Ranked title="Bots, by what gave them away" rows={data.bots.reasons} unit="visitor" />
            <Ranked title="Paths scanners tried" rows={data.bots.probes} unit="request" />

            <footer className="card wide about">
              <p>
                A <strong>visitor</strong> is one browser on one day. It counts once it has loaded a page and the site&apos;s
                code or pictures, from a browser that looks current, without hunting for paths the site never had.
                <strong> Unconfirmed</strong> visitors loaded a page and nothing more. That&apos;s a returning visitor
                whose browser kept the code, or a scanner careful enough to pass. Only the page someone lands on and full
                reloads show up, not moves between pages inside the site.
              </p>
              <p className="dim">
                From Amplify&apos;s access logs, fetched every hour.
                {f?.lastOkAt ? ` Last fetched ${ago(f.lastOkAt)}.` : ' Not fetched yet.'}
                {f?.newestHit ? ` Newest request ${ago(f.newestHit)}.` : ''}
                {f?.oldestHit ? ` Records start ${when(f.oldestHit)}.` : ''}
              </p>
            </footer>
          </>
        )}
      </main>
    </div>
  )
}

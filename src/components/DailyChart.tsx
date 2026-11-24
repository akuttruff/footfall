import { useLayoutEffect, useRef, useState } from 'react'
import type { DayCount } from '../types.ts'
import { dayLabel, plural } from '../lib/format.ts'

/** The element's width in CSS pixels, kept current. */
function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = (): void => { if (el.clientWidth > 0) setWidth(el.clientWidth) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/**
 * Visitors a day, one bar each. One series, so the title names it and there
 * is no legend; touching or hovering a bar reads out its day. Drawn at its
 * real width, so the text stays the size it is set at.
 */
export default function DailyChart({ days, recordsFrom }: { days: DayCount[]; recordsFrom: string | null }) {
  const [ref, W] = useWidth<HTMLDivElement>(640)
  const [active, setActive] = useState<number | null>(null)
  const H = 170
  const PAD = { top: 8, right: 2, bottom: 22, left: 26 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const max = Math.max(1, ...days.map((d) => d.visitors))
  // Round the top up to a clean step so the grid reads in whole numbers.
  const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 50) * 10
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step)
  const slot = plotW / days.length
  const gap = Math.min(2, slot * 0.25)
  const barW = Math.max(1, slot - gap)
  const y = (v: number): number => PAD.top + plotH - (v / top) * plotH
  // A date label every so often, at least 64px apart so they never collide.
  const every = Math.max(1, Math.ceil(64 / slot))
  const labelled = (i: number): boolean => i === days.length - 1 || (i % every === 0 && days.length - 1 - i >= every)
  const shown = active !== null ? days[active] : null
  const unrecorded = recordsFrom ? days.findIndex((d) => d.day >= recordsFrom) : 0

  return (
    <div className="chart" ref={ref}>
      <div className="chart-readout" aria-live="polite">
        {shown
          ? (recordsFrom && shown.day < recordsFrom
            ? <><strong>{dayLabel(shown.day)}</strong> · <span className="dim">before records begin</span></>
            : <><strong>{dayLabel(shown.day)}</strong> · {plural(shown.visitors, 'visitor')} · {plural(shown.views, 'page view')}</>)
          : <span className="dim">Touch a day for its numbers</span>}
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Visitors a day" onMouseLeave={() => setActive(null)}>
        {unrecorded > 0 && (
          <g>
            <rect x={PAD.left} y={PAD.top} width={unrecorded * slot} height={plotH} className="unrecorded" />
            {unrecorded * slot > 90 && (
              <text x={PAD.left + (unrecorded * slot) / 2} y={PAD.top + plotH / 2} className="tick" textAnchor="middle" dominantBaseline="middle">No records yet</text>
            )}
          </g>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
            <text x={PAD.left - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">{t}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = PAD.left + i * slot + gap / 2
          const h = y(0) - y(d.visitors)
          const r = Math.min(4, barW / 2, h)
          const last = i === days.length - 1
          return (
            <g key={d.day}>
              {d.visitors > 0 && (
                // Rounded at the data end only, square on the baseline.
                <path
                  className={`bar${active === i ? ' on' : ''}`}
                  d={`M${x},${y(0)} V${y(d.visitors) + r} Q${x},${y(d.visitors)} ${x + r},${y(d.visitors)} H${x + barW - r} Q${x + barW},${y(d.visitors)} ${x + barW},${y(d.visitors) + r} V${y(0)} Z`}
                />
              )}
              {labelled(i) && (
                <text x={last ? x + barW : x + barW / 2} y={H - 6} className="tick" textAnchor={last ? 'end' : 'middle'}>{dayLabel(d.day, false)}</text>
              )}
              {/* The whole column is the target, bigger than the bar. */}
              <rect
                x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} className="hit"
                onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}
              >
                <title>{`${dayLabel(d.day)}: ${plural(d.visitors, 'visitor')}, ${plural(d.views, 'page view')}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

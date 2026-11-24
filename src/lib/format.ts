/** Small formatters the page shares. */

export const plural = (n: number, word: string, many = `${word}s`): string => `${n.toLocaleString()} ${n === 1 ? word : many}`

/** The change from the span before, as "+40%" / "−12%" / "new" / "same", or null when there is nothing to compare. */
export function change(now: number, before: number): string | null {
  if (before === 0) return now === 0 ? null : 'new'
  const pct = Math.round(((now - before) / before) * 100)
  if (pct === 0) return 'same'
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`
}

/** "3m ago", "2h ago", "4d ago". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A YYYY-MM-DD day as "Mon Nov 9". */
export function dayLabel(day: string, weekday = true): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `${weekday ? `${WEEKDAY[date.getDay()]} ` : ''}${MONTH[m - 1]} ${d}`
}

/** A time as "Nov 9, 4:26 PM" (or just the time when it is today). */
export function when(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return new Date(now).toDateString() === d.toDateString() ? time : `${MONTH[d.getMonth()]} ${d.getDate()}, ${time}`
}

/** A page path as the homepage names it. */
export function pageName(path: string): string {
  const names: Record<string, string> = { '/': 'Home', '/work': 'Work', '/projects': 'Projects', '/talks': 'Talks', '/music': 'Music', '/writing': 'Writing' }
  return names[path] ?? path
}

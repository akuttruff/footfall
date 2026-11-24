import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { change } from './lib/format.ts'
import type { Summary } from './types.ts'

const SUMMARY: Summary = {
  range: { key: '7d', from: '2026-11-03', to: '2026-11-09' },
  includeUnconfirmed: false,
  totals: { visitors: 4, views: 7, unconfirmed: 3, bots: 120, requests: 2000 },
  previous: { visitors: 2, views: 7 },
  recordsFrom: null,
  daily: Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-0${i + 3}`, visitors: i === 6 ? 3 : i === 2 ? 1 : 0, views: i === 6 ? 5 : i === 2 ? 2 : 0 })),
  pages: [{ key: '/projects', n: 5 }, { key: '/', n: 2 }],
  referrers: [{ key: 'google.com', n: 2 }],
  devices: [{ key: 'phone', n: 3 }],
  browsers: [{ key: 'Safari', n: 3 }],
  os: [{ key: 'iOS', n: 3 }],
  recent: [{ at: Date.parse('2026-11-09T18:00:00Z'), cls: 'person', pages: ['/', '/projects'], referrer: 'google.com', browser: 'Safari', os: 'iOS', device: 'phone' }],
  bots: { reasons: [{ key: 'crawler', n: 80 }], probes: [{ key: '/.env', n: 12 }] },
  fetch: { lastRunAt: Date.now(), lastOkAt: Date.now(), lastError: null, newestHit: Date.now(), oldestHit: Date.now(), running: false, gaps: [] },
}

const answer = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })

describe('App', () => {
  it('shows the totals, the lists and the recent visits', async () => {
    const fetchMock = vi.fn(async () => answer(SUMMARY))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    const totals = await screen.findByRole('region', { name: 'Totals' })
    expect(within(totals).getByText('Visitors').parentElement).toHaveTextContent('4+100%')
    expect(within(totals).getByText('Page views').parentElement).toHaveTextContent('7same')
    expect(screen.getByRole('list', { name: 'Pages' })).toHaveTextContent('Projects5Home2')
    expect(screen.getByText('Home → Projects')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/summary?range=30d&unconfirmed=0')
  })

  it('asks again for another range or with the unconfirmed counted, and remembers it', async () => {
    const fetchMock = vi.fn(async () => answer(SUMMARY))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await screen.findByRole('region', { name: 'Totals' })
    await userEvent.click(screen.getByRole('button', { name: '7d' }))
    await userEvent.click(screen.getByRole('checkbox'))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/summary?range=7d&unconfirmed=1')
    expect(localStorage.getItem('range')).toBe('7d')
    expect(localStorage.getItem('unconfirmed')).toBe('1')
  })

  it('makes no comparison before records reach back that far, and says when they start', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ ...SUMMARY, previous: null, recordsFrom: '2026-11-05' })))
    render(<App />)
    const totals = await screen.findByRole('region', { name: 'Totals' })
    expect(within(totals).getByText('Visitors').parentElement).toHaveTextContent('4 since Nov 5')
    expect(screen.getByText('No records yet')).toBeInTheDocument()
  })

  it('says when the last fetch from Amplify failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ ...SUMMARY, fetch: { ...SUMMARY.fetch, lastError: 'ExpiredToken' } })))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The last fetch from Amplify failed: ExpiredToken')
  })

  it('reads the day of a bar when it is touched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(SUMMARY)))
    const { container } = render(<App />)
    await screen.findByRole('region', { name: 'Totals' })
    await userEvent.click(container.querySelectorAll('.chart .hit')[6])
    expect(screen.getByText('Mon Nov 9')).toBeInTheDocument()
    expect(screen.getByText(/3 visitors · 5 page views/)).toBeInTheDocument()
  })
})

describe('change', () => {
  it('reads as a percentage, or new, or same', () => {
    expect(change(4, 2)).toBe('+100%')
    expect(change(1, 4)).toBe('−75%')
    expect(change(3, 3)).toBe('same')
    expect(change(2, 0)).toBe('new')
    expect(change(0, 0)).toBeNull()
  })
})

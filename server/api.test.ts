// @vitest-environment node
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiState, createMiddleware } from './api.ts'
import type { ApiState } from './api.ts'
import { logText } from './fixtures.ts'
import { parseLog } from './logs.ts'

let dir: string
let state: ApiState
let server: http.Server
let base: string

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footfall-api-'))
  const now = new Date().toISOString()
  state = createApiState({ dir, source: async () => parseLog(logText([{ at: now, path: '/', id: 'one' }])) })
  const mw = createMiddleware(state)
  server = http.createServer((req, res) => mw(req, res, () => { res.writeHead(404); res.end() }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  await new Promise((r) => server.close(r))
  state.store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('api', () => {
  it('fetches on request, then summarizes', async () => {
    const f = await fetch(`${base}/api/fetch`, { method: 'POST' })
    expect(((await f.json()) as { added: number }).added).toBe(1)
    const s = await (await fetch(`${base}/api/summary?range=7d&unconfirmed=1`)).json() as { totals: { visitors: number }; fetch: { lastError: string | null } }
    expect(s.totals.visitors).toBe(1)
    expect(s.fetch.lastError).toBeNull()
  })

  it('refuses an unknown range and a write from another site', async () => {
    expect((await fetch(`${base}/api/summary?range=2w`)).status).toBe(400)
    expect((await fetch(`${base}/api/fetch`, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status).toBe(403)
  })

  it('reports health, with Amplify down until a fetch has worked', async () => {
    const before = await (await fetch(`${base}/api/health`)).json() as { app: string; deps: Record<string, string> }
    expect(before.app).toBe('footfall')
    expect(before.deps.amplify).toBe('down')
  })
})

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { RANGES } from '../src/types.ts'
import type { RangeKey } from '../src/types.ts'
import { Collector, amplifyConfig, amplifySource } from './collector.ts'
import type { LogSource } from './collector.ts'
import { HealthCheck } from './health.ts'
import { Store } from './store.ts'

export interface ApiOptions {
  dir?: string
  /** Where the requests come from; Amplify by default, when its app is set. */
  source?: LogSource | null
  /** Fetch on a timer (the real instance does; dev and tests fetch only when asked). */
  start?: boolean
}

export interface ApiState {
  store: Store
  collector: Collector
  health: HealthCheck
  /** The site being counted, shown on the page. */
  site: string | null
}

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void

/** Two missed hourly rounds and the numbers are stale enough to say so. */
const STALE_MS = 3 * 3600_000

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** A state-changing request must come from this app's own page, not from any tab on a tailnet device. */
function sameOrigin(req: IncomingMessage): boolean {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return true
  const origin = req.headers.origin
  if (!origin) return true // curl and scripts send none
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

export function createApiState(options: ApiOptions = {}): ApiState {
  const store = new Store(options.dir)
  const config = amplifyConfig()
  const source = options.source !== undefined ? options.source : config && amplifySource(config)
  const collector = new Collector(store, source)
  const health = new HealthCheck({
    app: 'footfall',
    dataFile: store.file,
    busy: (): Record<string, number> => (collector.running ? { fetch: 1 } : {}),
    deps: {
      // Amplify's logs: down when the last round failed or none has succeeded for a while.
      amplify: async () => {
        const s = collector.status()
        if (s.lastError) throw new Error(s.lastError)
        if (s.lastOkAt === null || Date.now() - s.lastOkAt > STALE_MS) throw new Error('no fetch has succeeded in the last three hours')
      },
    },
  })
  if (options.start) collector.start()
  return { store, collector, health, site: config?.domain ?? null }
}

export function createMiddleware(state: ApiState): Handler {
  const { store, collector } = state

  return (req, res, next) => {
    const [rawUrl = ''] = (req.url ?? '').split('?')
    if (!rawUrl.startsWith('/api/')) return next()
    if (!sameOrigin(req)) return json(res, 403, { error: 'cross-origin write refused' })
    const url = rawUrl.replace(/\/+$/, '')
    const query = new URL(req.url ?? '/', 'http://x').searchParams
    const method = req.method ?? 'GET'

    if (url === '/api/health' && method === 'GET') { void state.health.report().then((h) => json(res, 200, h)); return undefined }

    if (url === '/api/summary' && method === 'GET') {
      const range = (query.get('range') ?? '30d') as RangeKey
      if (!(range in RANGES)) return json(res, 400, { error: `range is one of ${Object.keys(RANGES).join(', ')}` })
      return json(res, 200, { ...store.summary(range, query.get('unconfirmed') === '1', collector.status()), site: state.site })
    }

    // Fetch now rather than wait for the hour; answers once the round is done.
    if (url === '/api/fetch' && method === 'POST') {
      void collector.fetch().then((added) => json(res, 200, { added, fetch: collector.status() }))
      return undefined
    }

    return json(res, 404, { error: `No such route: ${method} ${url}` })
  }
}

const shared = globalThis as { __footfallApi?: Map<string, ApiState> }

/** The API as a Vite plugin, for `vite dev` and `vite preview` alike; one state per data dir survives a config reload. */
export default function api(options: ApiOptions = {}): Plugin {
  const states = (shared.__footfallApi ??= new Map())
  const key = options.dir ?? '.data'
  let state = states.get(key)
  if (!state) {
    state = createApiState(options)
    states.set(key, state)
  }
  const middleware = createMiddleware(state)
  return {
    name: 'footfall-api',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}

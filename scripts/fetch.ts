// One fetch round by hand, into the dev database (or the real one with
// FOOTFALL_DATA=.data), printing what came in and the 7-day summary.
import path from 'node:path'
import { Collector, amplifyConfig, amplifySource } from '../server/collector.ts'
import { Store } from '../server/store.ts'

const config = amplifyConfig()
if (!config) { console.error('Set AWS_AMPLIFY_APP_ID (or FOOTFALL_APP_ID) and FOOTFALL_DOMAIN first.'); process.exit(1) }
const store = new Store(path.resolve(process.env.FOOTFALL_DATA ?? '.data-dev'))
const collector = new Collector(store, amplifySource(config))
const added = await collector.fetch()
const s = store.summary('7d', false, collector.status())
console.log(`added ${added} requests; ${JSON.stringify(collector.status())}`)
console.log(JSON.stringify({ totals: s.totals, daily: s.daily, pages: s.pages, referrers: s.referrers, bots: s.bots, recent: s.recent.slice(0, 10) }, null, 2))
store.close()

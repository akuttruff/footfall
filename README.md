# <img src="public/icon-180.png" width="32" alt=""> Footfall

Who visits a static site hosted on AWS Amplify: how many people a day,
which pages they land on, where they came from and on what, with the
crawlers and vulnerability scanners counted separately. It runs on a Mac
at home and is reached from a phone over Tailscale.

## Where the numbers come from

The site is static files on AWS Amplify Hosting. Footfall reads
Amplify's own access logs, so the site needs no tracking script, sets no
cookies, and nothing on the Mac is open to the internet. Every hour it asks
Amplify (`aws amplify generate-access-logs`, with the AWS CLI profile in
`FOOTFALL_PROFILE`) for the requests since its last round.
On its first run it fetches the last thirteen days, about as far back as
Amplify keeps.

What that means for the numbers:

- **Landing pages only.** The homepage is a single-page app, so a move
  from one page to another inside it never reaches the server. Footfall
  sees the page someone arrives on and any full reload, not the clicks
  between pages.
- **Up to an hour behind.** Requests reach the logs in batches. The refresh
  button fetches at once.
- **No country.** The logs don't say where a visitor is.

## Telling people from bots

Most requests aren't people. Crawlers (search engines, SEO tools, AI
crawlers) say what they are. Vulnerability scanners don't: they pose as
browsers and try paths like `/.env`, `/wp-login.php` and `/login`.

A **visitor** is one browser on one day, identified by a salted hash of its
address, user agent and date. The address itself is never stored. Each
visitor-day is classed by everything it did (`server/classify.ts`):

- **A bot** has any of these:
  - a crawler's user agent, or something that isn't a browser at all;
  - a browser a year or more out of date;
  - a path only an attacker asks for, or several paths the site never had.
- **A person** loaded a page and then the site's code or pictures.
- **Unconfirmed** loaded a page and nothing more. That can be someone
  returning whose browser kept the code, or a careful scanner. These are
  left out of the counts unless *Count unconfirmed* is on.

## Running it

Node 24 or newer. `npm install`, then:

- **Dev server:** `npm run dev` on :8600, against a scratch database in
  `.data-dev`. It fetches only when you press refresh.
- **Real instance:** `npm run preview` on :8610 is the real instance. A
  launchd agent (`local.footfall`) keeps it running, it fetches every
  hour into `.data`, and `tailscale serve` puts it on the tailnet at :8447.
  The range buttons run from 7 days to **All**, everything since the
  first record.
- **Deploy:** `npm run deploy` rebuilds and restarts the real instance.
- **First install:** run once, with your own values:

  ```sh
  AWS_AMPLIFY_APP_ID=d1234abcd FOOTFALL_DOMAIN=example.com \
  FOOTFALL_PROFILE=my-aws-profile sh scripts/install.sh
  ```

  It installs the launchd agent, starts it, and sets up `tailscale serve`.
- **Manual fetch:** with the same variables set, `npm run fetch` runs one fetch round into `.data-dev`
  and prints the week.
- **Checks:** `npm run check` runs the typecheck, the lint and the tests.

`GET /api/health` answers in the same shape as the other apps, so
Barometer watches it. Its `amplify` dependency reads down when the last
fetch failed, or when no fetch has succeeded for three hours.

## How it is built

React 19, TypeScript and Vite for the page. Node 24 with `node:sqlite` for
the server, which runs inside Vite as a plugin (`server/api.ts`), as in
Barometer.

One SQLite file, `.data/footfall.sqlite`, keeps each request that says
something, with no end date. Redirects say nothing and are dropped. Each
request is stored with the visitor hash and the user agent, which is kept
once per distinct agent. That's about 75 MB a year at today's traffic.

The history grows past Amplify's two weeks for as long as the hourly fetch
keeps running. If Footfall is off for longer than Amplify keeps logs,
whatever fell outside that window can't be fetched later. The collector
records each such gap, and the page shows it. The `backup-data` job copies
the file every night into `~/Backups/footfall/`.

The chart is plain SVG.

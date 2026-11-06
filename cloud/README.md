# TLI market: the public price and build database

A Cloudflare Worker (`src/index.js`) over a D1 database (`schema.sql`). Planner users who turn on
sharing send what they saw items listed for; the Worker folds those sightings into prices per item
and roll every hour, and serves them, cached, to the planner and the website. Builds are shared
on purpose, one click each, with no player name or id.

Everything fits Cloudflare's free plan: 100k requests a day, D1's 5M row reads and 100k writes a
day, 5 GB. `Cache-Control` on every GET lets Cloudflare's cache answer repeats without touching the
Worker, and the planner downloads a season's whole price table in one request (`/v1/export/prices`)
and keeps it for 30 minutes, so a thousand users cost a few thousand requests a day.

## Deploy

```
npm install -g wrangler
wrangler login
cd cloud
wrangler d1 create tli-market                       # paste database_id into wrangler.toml
wrangler d1 execute tli-market --remote --file=schema.sql
wrangler secret put REPORTER_SALT                   # any long random string (hashes reporter ids)
wrangler secret put FOLD_TOKEN                      # optional: lets you POST /v1/admin/fold by hand
wrangler deploy                                     # prints https://tli-market.<subdomain>.workers.dev
```

Then point the planner at it (`TLI_CLOUD_URL` in `.env`, or `DEFAULT_URL` in
`server/cloud/client.js` for the packaged overlay) and the site (`MARKET_API_URL` repository
variable, see `.github/workflows/pages.yml`). `.github/workflows/worker.yml` redeploys on every
push that touches `cloud/`, given the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.

## API

| | |
| --- | --- |
| `GET /v1/seasons` | seasons with prices, newest first |
| `GET /v1/prices?season=&q=&family=&kind=&limit=` | folded prices by signature; `q` searches names |
| `GET /v1/prices/family/:family` | one item any roll, plus every roll signature seen |
| `GET /v1/prices/signature/:signature` | one exact signature |
| `GET /v1/export/prices?season=` | the whole season (what the planner caches) |
| `POST /v1/observations` | `{ season, reporter, observations: [{ signature, price, name?, uniqueId?, baseId?, type?, listings?, source, mods?, seenAt }] }`, up to 50 |
| `GET /v1/builds?season=&hero=&skill=&family=` | shared builds, best DPS first |
| `GET /v1/builds/:id` | one build in full |
| `POST /v1/builds` | `{ reporter, build }` (the planner's `buildSummary`) |

Signatures come from `server/cloud/signature.js` in the planner: `L<uniqueId>|<affixId>:<roll bucket>,…`
for a legendary (bucket 0 = bottom fifth of the range, 4 = top fifth), `R<baseId>|<affix family>T<tier>,…`
for a rare with Ultimate or T0 lines, `B<baseId>` for anything priced per unit. The part before
`|` is the family.

## Limits and abuse

- Per-IP rate limits (`[[ratelimits]]` in `wrangler.toml`): 120 reads and 20 writes a minute.
- A reporter is a random UUID the planner makes once; the Worker stores a salted SHA-256 of it.
  One reporter counts once per item, per day, per source, and each reporter's newest price counts
  once in a fold, so a looping client can't move a price alone. IPs are never stored.
- Prices beyond 1.5 IQR are dropped once an item has six or more sightings.
- Bodies over 256 KB, more than 50 observations, prices over 100M FE, and anything malformed are
  rejected with 400/413.
- Observations older than 120 days are deleted in the hourly fold; prices use the last
  `PRICE_WINDOW_DAYS` (14).

## Tests

`cloud/test/worker.test.js` runs the Worker's routes against an in-memory SQLite standing in for
D1 (`npm test` from the repo root runs it too).

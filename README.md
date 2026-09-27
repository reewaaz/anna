# Anna — Archive Search (PWA)

A portable, installable web app to **search Anna's Archive** by category
(**Top Links / Books / Articles**), with **advanced filters** (language,
format, sort, year range) and an **in-app viewer** that opens results inside
the app (falling back to your browser when a site blocks framing).

It is a static PWA — no backend, no build step. It runs anywhere it can be
served over `http(s)` or `localhost`, and installs as an app on Windows
(Edge/Chrome → *Install*) and Android (Chrome → *Add to Home Screen*).

## Data source & how search works
Anna's Archive has **no official public API** and sits behind **DDoS-Guard** bot
protection, and its pages can't be fetched cross-origin from a browser. So the
app routes requests through a **CORS proxy**:

```
browser → CORS proxy → https://annas-archive.gl/search?q=…&content=…&ext=…&sort=…
```

The returned HTML is parsed in the browser into result cards.

> **Proxy note (important).** Anna's Archive sits behind aggressive DDoS-Guard
> bot protection, which blocks most shared/public CORS proxies. The app routes
> requests through a Cloudflare Worker (see below) and auto-selects the first
> upstream mirror that responds.
>
> This is a discovery tool — please respect Anna's rate limits.

## Current state of the upstream (verified 2026-09-27)

The Worker at `anna-proxy.riwaj-p.workers.dev` is **deployed and working**. The
`/search` route of the primary mirror `annas-archive.gl` is **not** reachable by
any automated client:

| Mirror | `/search` result |
|---|---|
| `annas-archive.gl` | **403** DDoS-Guard JS challenge (also with a browser UA, and directly from a residential IP) |
| `annas-archive.is` | **200** — the only mirror currently serving results |
| `annas-archive.{org,nu,la,cat,cr,tw,to,ws,nz,se}` | **530** origin down |
| `annas-archive.{li,gs}` | antibot stubs (`Click for continue…`) |
| `annas-archive.ph` | 403 · `.vg` 526 · `.cc` 404 |
| `annas-archive.rs` | **domain squatter** — removed from the Worker's allowlist |

`robots.txt` also declares `Disallow: /search` and `Crawl-delay: 10`.

### What this means for the features

Measured directly against the live mirror, not assumed:

| Filter | `annas-archive.is` | How the app handles it |
|---|---|---|
| Query (`q`) | works | sent upstream |
| Page (`page`) | works | sent upstream |
| File format | works (`extension=`, 8 formats) | sent upstream |
| Sort | **ignored** — `sort=title` returns results in the *same order* as no sort; `sort=oldest/largest/smallest` return 0 results | applied in the browser |
| Year range | **ignored** — `year_from=1990` still returns a 1982 book | applied in the browser |
| Language | **broken** — every value returns 0 results | disabled, with the reason shown |
| Category (`content=`) | **ignored** — `content=magazines` still returns 20 "Books catalog" cards | disabled, with the reason shown |
| Download links | **sign-in required** | the modal says so instead of showing an empty list |

**Sorting and year range are done client-side.** The mirror ignores both, so
they are not sent upstream at all — sending them would be worse than useless,
since three of the four sort values return *zero* results. Instead the app sorts
and filters the cards it has already loaded, using metadata that is present on
essentially all of them: title on 100%, file size on 100%, year on ~70%.

Two honest limits, both surfaced in the UI rather than hidden:

- It sorts the **current page** of results, not the whole corpus. The mirror note
  says so, and **Load more** widens it.
- About 30% of cards carry no year. When a year range is set those are **excluded**,
  because there is no way to tell whether they fall inside it, and the status line
  reports how many were left out.

Language could not be rescued this way: upstream returns nothing for it *and* the
cards carry no language field at all (0% across 100 sampled cards), so there is
nothing to filter on. It stays disabled.

The app parses **two** result layouts (the legacy `.gl` list and the current
catalog card grid) and fails over between mirrors automatically, so it recovers
on its own if a mirror changes.

A search that legitimately matches nothing is now reported as "no results", not
as a failure. Both look identical to the parser — zero cards — so the app checks
whether the page is a real results page before calling it a layout change. This
was the cause of the misleading `(is: parse, gl: challenge)` message.

## Features
- Search by query, with file-format filtering and pagination.
- Filters that the active mirror cannot honour are **disabled and labelled**,
  so you never get silently-unfiltered results.
- Automatic mirror failover, and a real error message when every mirror fails
  (it tells you *why* — bot protection, HTTP status, empty page, or a layout
  change — instead of guessing).
- Result cards with cover, title, author, format, size, year.
- **In-app viewer**: click a result to open it in an embedded iframe. If the
  site refuses to be framed, a *↗ Browser* button (and automatic fallback)
  opens it in your system browser.
- Installable offline PWA (service worker caches the app shell).
- All settings (proxy choice) persisted in `localStorage`.

## Run it locally (Windows)
Any static server works (service workers need a secure context, so `file://`
won't enable install/offline — use a local server):

```powershell
# Python 3
python -m http.server 8000
# then open http://localhost:8000/
```

or

```powershell
npx serve .
```

## Deploy to GitHub Pages (repo `anna`)
1. Push this folder to the `anna` repo.
2. Add a `.nojekyll` file (already included) so GitHub's Jekyll ignores the
   files.
3. In repo **Settings → Pages**, set the source to the branch root.
4. The app will be live at `https://<user>.github.io/anna/`.
   Open it on Android and choose *Add to Home Screen* to install.

Use **relative paths** (`./`) — already configured in `manifest.webmanifest`
and the service worker — so it works under the `/anna/` subpath.

## The proxy Worker

`worker/worker.js` is already deployed at
`https://anna-proxy.riwaj-p.workers.dev/?url=<encoded-url>` and is the app's
default proxy. To redeploy after editing it:

```bash
cd worker
wrangler login          # once; needs an interactive terminal
wrangler deploy         # uses worker/wrangler.toml
```

The Worker:

- allowlists Anna's Archive hosts explicitly (so it can't be used as an open proxy)
- detects the DDoS-Guard interstitial and reports it via the `x-anna-challenge` header
- never caches a block or an error response (`cache-control: no-store`)

To use a different proxy, set it in *Settings → Custom proxy* in the form
`https://your-worker.dev/?url=`.

## File layout
```
index.html
.nojekyll
css/styles.css
js/search.js     # mirror profiles + capabilities, URL builder, fetch, error classification
js/parser.js     # result extraction for both the catalog and legacy layouts
js/viewer.js     # in-app iframe viewer + fallback
js/app.js        # UI: tabs, grid, filters, capability gating
manifest.webmanifest
sw.js            # offline app-shell cache
worker/worker.js # CORS proxy (Cloudflare Worker)
icons/icon.svg
```

## Adding or changing a mirror

Mirrors are declared in `js/search.js` (`MIRRORS`). Each entry states the
capabilities it actually honours, so the app can disable what it cannot do:

```js
{
  id: 'is',
  origin: 'https://annas-archive.is',
  caps: { q: true, page: true, ext: true, lang: false, sort: false, content: false, year: false },
  local: ['sort', 'year'],
  paramMap: { q: 'q', page: 'page', ext: 'extension' },
  formats: ['pdf', 'epub', 'mobi', 'azw3', 'djvu', 'fb2', 'txt', 'rtf'],
  notes: ['...']
}
```

A capability is one of three things:

| Value | Meaning |
|---|---|
| `true` | the mirror honours it — sent as a query parameter |
| `'local'` *(the `local` array)* | upstream ignores it, but the app can honour it in the browser from the card metadata, so it is **not** dropped and the control stays enabled |
| `false` | nothing can honour it — the control is disabled with a reason |

`paramMap` maps the app's filter names to the mirror's query parameters —
`annas-archive.is` spells them `language` and `extension`, not `lang` and `ext`.
The host must also be added to `ALLOWED_HOSTS` in `worker/worker.js`.

Verify a mirror's real behaviour before claiming a capability:

```
https://<mirror>/search?q=python&<param>=<value>
```

Compare result IDs against the unfiltered query — identical IDs mean the
parameter is ignored, zero results means it is broken.

## Notes & limitations
- In-app framing of Anna's detail pages may be blocked (`X-Frame-Options` /
  `frame-ancestors`); the app automatically offers an external-browser fallback.
- `annas-archive.is` requires a signed-in account before it reveals download
  links. The app detects this and says so instead of showing an empty list.
- Search depends on upstream HTML staying the same. The parser detects layouts
  structurally and the client fails over between mirrors, but a large redesign
  would need a new parser path.
- This tool only helps **discover** catalog entries. Downloading/accessing
  content is subject to Anna's Archive terms and your local laws.

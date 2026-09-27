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

`annas-archive.is` honours only two of the app's filter dimensions. The app now
**knows this** and disables the unsupported controls rather than silently
returning unfiltered results:

| Filter | `annas-archive.is` | `annas-archive.gl` |
|---|---|---|
| Query (`q`) | works | works |
| Page (`page`) | works | works |
| File format | works (`extension=`, 8 formats) | works |
| Language | **broken** — every value returns 0 results | supported |
| Sort | **broken** — every value returns 0 results | supported |
| Category (`content=`) | **ignored** | supported |
| Year range | **ignored** | supported |
| Download links | **sign-in required** | supported anonymously |

The app also parses **two** result layouts (the legacy `.gl` list and the current
catalog card grid) and fails over between mirrors automatically, so it recovers
on its own if a mirror changes.

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
  paramMap: { q: 'q', page: 'page', ext: 'extension' },
  formats: ['pdf', 'epub', 'mobi', 'azw3', 'djvu', 'fb2', 'txt', 'rtf'],
  notes: ['...']
}
```

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

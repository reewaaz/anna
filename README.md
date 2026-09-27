# Anna — Archive Search (PWA)

A portable, installable web app to **search Anna's Archive** by category
(**Fiction / Non-fiction / Articles / Magazines / Standards**, or all of it at
once), with **advanced filters** (format, sort, year range) and an **in-app
viewer** that opens results inside the app (falling back to your browser when a
site blocks framing).

It is a static PWA — no backend, no build step. It runs anywhere it can be
served over `http(s)` or `localhost`, and installs as an app on Windows
(Edge/Chrome → *Install*) and Android (Chrome → *Add to Home Screen*).

## Data source & how search works
Anna's Archive has **no official public API** and sits behind **DDoS-Guard** bot
protection, and its pages can't be fetched cross-origin from a browser. So the
app routes requests through a **CORS proxy**:

```
browser → CORS proxy → https://annas-archive.is/search?q=…&extension=…&category=…
```

The returned HTML is parsed in the browser into result cards.

> **Proxy note (important).** Anna's Archive sits behind aggressive DDoS-Guard
> bot protection, which blocks most shared/public CORS proxies. The app routes
> requests through a Cloudflare Worker (see below) and auto-selects the first
> upstream mirror that responds.
>
> This is a discovery tool — please respect Anna's rate limits.

## Current state of the upstream (verified 2026-09-27)

The Worker at `anna-proxy.riwaj-p.workers.dev` is **deployed and working**. Of the
mirrors the app knows about, only `annas-archive.is` serves `/search` to an
automated client; every other one is blocked:

| Mirror | `/search` result |
|---|---|
| `annas-archive.is` | **200** - the only mirror currently serving results |
| `annas-archive.gl` | **403** DDoS-Guard JS challenge (also with a browser UA, and directly from a residential IP) |
| `annas-archive.gd` | **302 -> `?check=1`** - same DDoS-Guard, `Server: ddos-guard` |
| `annas-archive.pk` | **403** DDoS-Guard JS challenge |
| `annas-archive.{org,nu,la,cat,cr,tw,to,ws,nz,se}` | **530** origin down |
| `annas-archive.{li,gs}` | antibot stubs (`Click for continue...`) |
| `annas-archive.ph` | 403 / `.vg` 526 / `.cc` 404 |
| `annas-archive.rs` | **domain squatter** - removed from the Worker's allowlist |

`robots.txt` declares `Disallow: /search` and `Crawl-delay: 10` on `.gl`, `.pk`
**and** `.gd`. `.is` is the only mirror whose `robots.txt` permits `/search`.

`.gd`, `.gl` and `.pk` are the three domains tracked by the Shadow Libraries
directory and its uptime monitor, and all three sit behind the same bot
protection. That directory is a link list, not a search index - it has no search
of its own, and its "can't access the site?" section is DNS/VPN/TOR advice,
which this project does not implement. There is no alternate host there that
serves `/search`.

### What this means for the features

Measured directly against the live mirror, not assumed:

| Filter | `annas-archive.is` | How the app handles it |
|---|---|---|
| Query (`q`) | works | sent upstream |
| Page (`page`) | works | sent upstream |
| File format | works (`extension=`, 8 formats) | sent upstream |
| Category | works (`category=`, 5 slugs) | sent upstream |
| Sort | **ignored** — `sort=title` returns results in the *same order* as no sort; `sort=oldest/largest/smallest` return 0 results | applied in the browser |
| Year range | **ignored** — `year_from=1990` still returns a 1982 book | applied in the browser |
| Language | **broken** — every value returns 0 results | disabled, with the reason shown |
| `content=` | **ignored** — still returns 20 "Books catalog" cards | never sent; see below |
| Download links | **sign-in required** | the modal says so instead of showing an empty list |

**Category was mis-probed for a long time, and that is what disabled the tabs.**
The mirror does support categories, under the parameter name **`category=`** —
read straight off the hidden input in the search form it renders on every
`/categories/<slug>` page. An earlier probe tested `content=` instead, which this
mirror silently ignores, concluded categories were unsupported, and greyed out
Fiction / Non-fiction / Articles / Magazines. Verification:

- `/search?category=fiction` returns a **byte-identical** result set to
  `/categories/fiction`, and the same holds for all five slugs.
- `q=dune&category=fiction` returns a *different* set from `q=dune`, and
  `q=dune&category=nonfiction` returns 0 — correct, since Dune is a novel.

The app now sends `category=` and refuses to send a slug the mirror does not
serve: an unrecognised one is answered with 0 results and HTTP 200, which is
indistinguishable from a real empty search. The pill nav, the preset chips and the
content-type select are three views of one value and are kept in step; a mirror
that cannot do categories hides the nav entirely rather than showing buttons that
quietly do nothing.

The translation layer supports mirrors that name their categories differently
(upstream spells this filter `content=`, with its own value names) and is unit
tested, but **no mirror currently claims it**: `annas-archive.gl` returns 403 to
everything, so its real value names cannot be checked, and an unverified mapping
does not fail loudly — it silently returns the wrong corpus. Its `caps.category`
is therefore `false` until someone can probe it. The same rule applies to
`sort` and `year` on that mirror, whose `true` caps are inherited from LibGen and
have never been verified either; they are unreachable while it is blocked, so
nothing depends on them today.

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

### Searches that find nothing here

Some searches that return results on annas-archive.org return nothing through this
mirror. The app is not at fault — the request it sends is identical to the one
the site's own search box sends, and direct fetch, Worker fetch and the app's own
parser agreed on all 25 queries they were compared across. Two properties of the
mirror cause it, both measured repeatedly:

- **Its search index is incomplete, and shifts as it is rebuilt.** `dune`,
  `the hobbit`, `lord of the rings`, `introduction to algorithms`, `tolkien` and
  `herbert` return 20 results, stably. `sicp`, `wellards` and
  `structure of computer programs` return 0, stably. `tolkien` returned 0 earlier
  the same day and 20 later. It is **not** title-only (`tolkien` is an author
  surname and works), and it is **not** throttling (a known-good query returned 20
  on 6 of 6 attempts while a known-empty one returned 0 on 3 of 3).
- **It combines query words with AND.** `orson wellards` returns nothing while
  `orson` alone returns 20, because `wellards` is absent from the index.

So when a search returns nothing the app automatically retries with progressively
shorter prefixes of the same query (at most two, so it never buries the mirror in
requests) and says which query it actually searched. A term that is absent at every
length stays honestly empty. The standing caveat is shown under the search box
rather than only on failure, because it is the single thing most likely to make a
working app look broken.

### Rate limiting

The mirror declares `Crawl-delay: 10` and answers **HTTP 429** readily — repeated
distinct queries 15 seconds apart still got throttled, while bursts of the same query
400 ms apart did not. So requests are paced 1.2 s apart, a 429 is retried once after a
short wait, and after that it is *reported* rather than retried: a throttle is a
signal from Anna's Archive to the client, not a fault in one mirror or one proxy, so
failing over to the next of either would only re-issue the request that was throttled.
The message says what happened and that waiting fixes it.

### Cancelling superseded requests

A search supersedes any request already in flight, and a response belonging to a
superseded search is discarded even if the abort did not land in time. The case that
matters is the background front page, which loads on every first visit: a user who
types a query before it arrives should get their search, not queue behind it. An
earlier attempt ignored the new search instead, which silently swallowed the first
real search of the session — and a cancelled search must never paint an error
over a good result set.

The app parses **two** result layouts (the legacy `.gl` list and the current
catalog card grid) and fails over between mirrors automatically, so it recovers
on its own if a mirror changes.

A search that legitimately matches nothing is now reported as "no results", not
as a failure. Both look identical to the parser — zero cards — so the app checks
whether the page is a real results page before calling it a layout change. This
was the cause of the misleading `(is: parse, gl: challenge)` message.

## Features
- Search by query, with file-format filtering and pagination.
- **Category tabs** — Fiction / Non-fiction / Articles / Magazines / Standards, or
  all of it, as pill nav, preset chips or a select. They are one value shown three
  ways, so they can never disagree with each other.
- A search that finds nothing is retried with shorter terms, and says which query
  it actually searched rather than implying the original one matched.
- Filters that the active mirror cannot honour are **disabled and labelled**,
  so you never get silently-unfiltered results.
- Automatic mirror failover, and a real error message when every mirror fails
  (it tells you *why* — bot protection, HTTP status, rate limit, empty page, or a
  layout change — instead of guessing).
- Requests are paced and superseded searches are cancelled, so the app neither
  trips the mirror's rate limit nor leaves a stale response to overwrite a fresh
  one.
- Result cards with cover, title, author, format, size, year.
- **In-app viewer**: click a result to open it in an embedded iframe. If the
  site refuses to be framed, a *→ Browser* button (and automatic fallback)
  opens it in your system browser.
- Installable offline PWA (service worker caches the app shell).
- All settings (proxy choice) persisted in `localStorage`.
- **Self-healing builds.** The app compares its own version stamp against the
  deployed `version.json` on boot. A browser running an old build drops its
  stale data snapshots and reloads itself, so a fix reaches the browser without
  anyone having to remember a hard refresh.

### Releasing a change

Bump `APP_VERSION` in `js/app.js` **and** `version` in `version.json` in the
same commit, and bump `CACHE` in `sw.js` when the app shell changed. The two
version stamps must always agree, or every visitor reloads on every load. The
reload is guarded per-version in `sessionStorage`, so a half-finished deploy
cannot turn into a reload loop.

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
  caps: { q: true, page: true, ext: true, category: true, lang: false, sort: false, content: false, year: false },
  // One canonical concept, `category`, each mirror spelled its own way: a mirror
  // with its own value names sets `content:` per slug instead of using its
  // paramMap entry. Only list values you have actually verified.
  paramMap: { q: 'q', page: 'page', ext: 'extension', category: 'category' },
  categories: [                          // only the slugs this mirror serves
    { slug: 'fiction', label: 'Fiction' },
    { slug: 'nonfiction', label: 'Non-fiction' },
    { slug: 'article', label: 'Articles' },
    { slug: 'magazine', label: 'Magazines' }
  ],
  local: ['sort', 'year'],
  formats: ['pdf', 'epub', 'mobi', 'azw3', 'djvu', 'fb2', 'txt', 'rtf'],
  notices: ['a standing caveat, shown under the search box'],
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

The `categories` list is not decoration. A mirror asked for a category it does
not serve answers with **0 results and HTTP 200**, which the app cannot tell
apart from a genuine empty search, so an unknown slug has to be refused before
it is sent rather than discovered afterwards.

`notices` are standing caveats shown under the search box on every page; `notes`
are per-mirror operational remarks shown alongside them. Use them for things a
user would otherwise blame on the app.

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

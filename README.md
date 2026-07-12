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

> **Works out of the box.** The app's default proxy (`cors.lol`) is reachable
> from Anna's Archive and sends CORS headers, so search works with **no setup**.
> If a proxy is ever blocked, the app automatically tries the others and can
> fall back to a personal Cloudflare Worker (set in *Settings → Custom proxy*).
> This is a discovery tool — please respect Anna's rate limits and don't hammer
> the site.

## Features
- Category tabs: **Top Links** (relevance across all content), **Books**,
  **Articles** (journals / magazines / standards).
- Advanced filters: content type, language, file extension, sort order,
  year-from / year-to.
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

## Use your own proxy (recommended for reliability)
Public proxies share IPs that Anna's protection may block. Deploy a tiny
**Cloudflare Worker** (free tier) and paste its URL into *Settings → Custom
proxy* (format: `https://your-worker.dev/?url=`).

Minimal Worker (`worker.js`):

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('missing url', { status: 400 });
    const r = await fetch(target, {
      headers: { 'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0' }
    });
    const body = r.body;
    return new Response(body, {
      status: r.status,
      headers: { 'Access-Control-Allow-Origin': '*', 'content-type': r.headers.get('content-type') || 'text/html' }
    });
  }
};
```

Deploy with the [Wrangler CLI](https://developers.cloudflare.com/workers/):

```bash
cd worker
wrangler deploy        # uses worker/wrangler.toml (no wrangler init needed)
```

It prints a URL like `https://anna-proxy.<subdomain>.workers.dev`. Paste that
into the app's **Settings → Custom proxy** (the app auto-falls back to it
whenever the public proxies are blocked).

## File layout
```
index.html
.nojekyll
css/styles.css
js/search.js     # proxy + Anna's URL builder + fetch
js/parser.js     # extract results from search HTML
js/viewer.js     # in-app iframe viewer + fallback
js/app.js        # UI: tabs, grid, filters, settings
manifest.webmanifest
sw.js            # offline app-shell cache
icons/icon.svg
```

## Notes & limitations
- In-app framing of Anna's detail pages may be blocked (`X-Frame-Options` /
  `frame-ancestors`); the app automatically offers an external-browser fallback.
- Search accuracy depends on Anna's HTML structure and the proxy staying
  unblocked; parsing is best-effort and tolerant of layout changes.
- This tool only helps **discover** catalog entries. Downloading/accessing
  content is subject to Anna's Archive terms and your local laws.

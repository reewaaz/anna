/*
 * Cloudflare Worker proxy for Anna — deploy with Wrangler.
 * Usage: https://<your-subdomain>.workers.dev/?url=<encoded-anna-url>
 *
 * Why: Anna's Archive sits behind DDoS-Guard, which blocks shared public
 * CORS proxies. A Worker runs on Cloudflare's network and is far less likely
 * to be challenged. Paste its URL into the app's Settings → Custom proxy.
 *
 * Deploy:  cd worker && wrangler deploy
 * Then the worker lives at https://<name>.<subdomain>.workers.dev/
 * Point the app at: https://<name>.<subdomain>.workers.dev/?url=
 */

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-User': '?1',
  'Sec-Fetch-Dest': 'document',
  'Upgrade-Insecure-Requests': '1'
};

/*
 * Explicit allowlist of Anna's Archive hostnames.
 *
 * This used to be a loose regex that included ".rs" — which turned out to be a
 * domain-squatter parking page, meaning the Worker would proxy it for anyone.
 * An explicit set is safer and easier to audit. Only add a host here after
 * confirming it actually serves Anna's Archive.
 */
const ALLOWED_HOSTS = new Set([
  'annas-archive.gl',
  'annas-archive.org',
  'annas-archive.is',
  'annas-archive.li',
  'annas-archive.se',
  'annas-archive.nu',
  'annas-archive.la',
  'annas-archive.cat',
  'annas-archive.cr',
  'annas-archive.tw',
  'annas-archive.gs',
  'annas-archive.vg',
  'annas-archive.sh',
  'annas-archive.to',
  'annas-archive.ws',
  'annas-archive.nz',
  'annas-archive.ph'
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra }
  });
}

/* Detect the DDoS-Guard interstitial so the client can explain the failure
   instead of guessing (the old client blamed an un-deployed Worker). */
function isChallenge(text) {
  return /DDoS-Guard|ddos-guard|check\.ddos-guard\.net/i.test(text.slice(0, 4000));
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) {
      return json({ error: 'missing_url' }, 400);
    }

    // Reject obviously non-Anna targets to avoid becoming an open proxy.
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return json({ error: 'invalid_url' }, 400);
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
      return json({ error: 'host_not_allowed' }, 403);
    }

    let upstream;
    try {
      upstream = await fetch(target, {
        headers: BROWSER_HEADERS,
        redirect: 'follow'
      });
    } catch (err) {
      return json({ error: 'upstream_unreachable', detail: String(err && err.message || err) }, 502);
    }

    // Buffer the body so we can inspect it. Search pages are ~100-200 KB,
    // which is well within a Worker's memory limit, and it lets us report
    // challenge pages precisely instead of relaying an opaque 403.
    let body;
    try {
      body = await upstream.text();
    } catch (err) {
      return json({ error: 'upstream_read_failed', detail: String(err && err.message || err) }, 502);
    }

    const challenged = isChallenge(body);
    const status = upstream.status;
    const ok = status >= 200 && status < 300 && !challenged;

    // Never cache a block or an error — caching a 403 challenge page
    // would keep serving it long after Anna's protection was lifted.
    const cacheControl = ok ? 'public, max-age=300' : 'no-store';

    if (!ok) {
      return new Response(body, {
        status: challenged && status === 200 ? 403 : status,
        headers: {
          ...CORS_HEADERS,
          'content-type': upstream.headers.get('content-type') || 'text/html; charset=utf-8',
          'cache-control': cacheControl,
          'x-anna-upstream-status': String(status),
          'x-anna-upstream-host': parsed.hostname,
          'x-anna-challenge': challenged ? '1' : '0'
        }
      });
    }

    return new Response(body, {
      status,
      headers: {
        ...CORS_HEADERS,
        'content-type': upstream.headers.get('content-type') || 'text/html; charset=utf-8',
        'cache-control': cacheControl,
        'x-anna-upstream-status': String(status),
        'x-anna-upstream-host': parsed.hostname,
        'x-anna-challenge': '0'
      }
    });
  }
};

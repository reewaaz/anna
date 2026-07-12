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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) {
      return new Response('Missing "url" query parameter', { status: 400 });
    }

    // Reject obviously non-Anna targets to avoid becoming an open proxy.
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return new Response('Invalid target URL', { status: 400 });
    }
    const host = parsed.hostname.toLowerCase();
    const allowed = /(^|\.)annas-archive\.(gl|org|li|se|is|fo|nu|la|cat|cr|tw|gs|vg|cc|nu|sh|to|ws|nz|rs|ph|net|io)$/;
    if (parsed.protocol !== 'https:' || !allowed.test(host)) {
      return new Response('Only Anna’s Archive URLs are allowed', { status: 403 });
    }

    const upstream = await fetch(target, {
      headers: BROWSER_HEADERS,
      redirect: 'follow'
    });

    const response = new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'content-type':
          upstream.headers.get('content-type') || 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300'
      }
    });
    return response;
  }
};

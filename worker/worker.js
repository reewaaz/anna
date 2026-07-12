/*
 * Cloudflare Worker proxy for Anna — deploy with Wrangler.
 * Usage: https://<your-subdomain>.workers.dev/?url=<encoded-anna-url>
 *
 * Why: Anna's Archive sits behind DDoS-Guard, which blocks shared public
 * CORS proxies. A Worker runs on Cloudflare's network and is far less likely
 * to be challenged. Paste its URL into the app's Settings → Custom proxy.
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) {
      return new Response('Missing "url" query parameter', { status: 400 });
    }

    const upstream = await fetch(target, {
      headers: {
        'User-Agent':
          request.headers.get('User-Agent') ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      redirect: 'follow'
    });

    const body = upstream.body;
    const response = new Response(body, {
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

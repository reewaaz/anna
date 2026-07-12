/* search.js — builds Anna's Archive URLs, fetches via a CORS proxy, returns HTML. */

const AA_BASE = 'https://annas-archive.gl/search';

const DEFAULT_PROXIES = [
  'https://anna.riwaj-p.workers.dev/?url='
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const Search = (() => {
  let proxies = [...DEFAULT_PROXIES];
  let fallbackProxy = '';

  function setProxies(list) {
    if (Array.isArray(list) && list.length) proxies = list;
  }

  function setFallback(proxy) {
    fallbackProxy = proxy || '';
  }

  /* Map a UI category tab to Anna's "content" filter. */
  function categoryToContent(category) {
    if (category === 'book_any') return 'book_any';
    if (category === 'article') return ['journal_article', 'magazine', 'standards_document'];
    return ''; // "top" -> all content
  }

  /* Build the Anna's Archive search URL for one query. */
  function buildUrl(opts) {
    const params = new URLSearchParams();
    params.set('q', opts.query);
    if (opts.lang) params.set('lang', opts.lang);
    if (opts.ext) params.set('ext', opts.ext);
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.yearFrom) params.set('year_from', opts.yearFrom);
    if (opts.yearTo) params.set('year_to', opts.yearTo);
    if (opts.content) params.set('content', opts.content);
    if (opts.page && opts.page > 1) params.set('page', opts.page);
    return `${AA_BASE}?${params.toString()}`;
  }

  /* Run multiple Anna queries (e.g. several article content types) and merge. */
  async function runQuerySet(urls, proxyFor) {
    const htmls = await Promise.all(
      urls.map((u) => fetchThroughProxies(u, proxyFor))
    );
    return htmls.filter(Boolean);
  }

  async function tryProxy(proxy, targetUrl) {
    const sep = proxy.includes('?') ? '' : '?url=';
    const url = proxy + sep + encodeURIComponent(targetUrl);
    let lastErr;
    // Retry once on 429 (rate limit) — the only working public proxy throttles.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'Accept': 'text/html' } });
        if (res.status === 429) { await sleep(1500); continue; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        // Reject proxy "error" pages (rate-limit / "need API key" messages),
        // which are short and contain no result links.
        if (!text || text.length < 5000) throw new Error('proxy returned an error page');
        return text;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  async function fetchThroughProxies(targetUrl, proxyOverride) {
    const list = proxyOverride && proxyOverride.length ? proxyOverride : proxies;
    let lastErr;
    for (const proxy of list) {
      try {
        return await tryProxy(proxy, targetUrl);
      } catch (err) {
        lastErr = err;
      }
    }
    // Auto-fallback: if a personal Worker/custom proxy is configured, try it
    // once public proxies are exhausted (Anna's DDoS-Guard blocks shared IPs).
    if (fallbackProxy && !list.includes(fallbackProxy)) {
      try {
        return await tryProxy(fallbackProxy, targetUrl);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('All proxies failed');
  }

  /* Silently probe each proxy and return the first that can reach Anna's.
     Runs in the background on load so the user never has to pick one. */
  async function detectWorkingProxy() {
    for (const proxy of proxies) {
      const sep = proxy.includes('?') ? '' : '?url=';
      const url = proxy + sep + encodeURIComponent('https://annas-archive.gl/');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { 'Accept': 'text/html' }
        });
        if (!res.ok) continue;
        const text = await res.text();
        if (text && text.length > 500) return proxy;
      } catch (_) {
        /* try next */
      } finally {
        clearTimeout(timer);
      }
    }
    return '';
  }

  /* Public: perform a search. Returns array of result objects. */
  async function search(opts) {
    const content = categoryToContent(opts.category);
    const contents = Array.isArray(content) ? content : [content];

    const urls = contents.map((c) =>
      buildUrl({
        query: opts.query,
        lang: opts.lang,
        ext: opts.ext,
        sort: opts.sort,
        yearFrom: opts.yearFrom,
        yearTo: opts.yearTo,
        content: c,
        page: opts.page || 1
      })
    );

    const htmls = await runQuerySet(urls, opts.proxyOverride);
    let merged = [];
    for (const html of htmls) {
      const results = Parser.parse(html);
      merged = merged.concat(results);
    }
    // De-duplicate by href.
    const seen = new Set();
    merged = merged.filter((r) => {
      if (!r.href || seen.has(r.href)) return false;
      seen.add(r.href);
      return true;
    });
    return merged;
  }

  function getPrimaryProxy() {
    return proxies[0] || '';
  }

  function proxiedUrl(target) {
    const p = getPrimaryProxy();
    if (!p) return target;
    const sep = p.includes('?') ? '' : '?url=';
    return p + sep + encodeURIComponent(target);
  }

  return { setProxies, setFallback, search, buildUrl, categoryToContent, detectWorkingProxy, getPrimaryProxy, proxiedUrl, DEFAULT_PROXIES };
})();

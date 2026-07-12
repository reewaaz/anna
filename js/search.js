/* search.js — builds Anna's Archive URLs, fetches via a CORS proxy, returns HTML. */

const AA_BASE = 'https://annas-archive.gl/search';

const DEFAULT_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?url=',
  'https://api.codetabs.com/v1/proxy/?quest=',
  'https://cors.eu.org/',
  'https://proxy.cors.sh/',
  'https://api.allorigins.win/get?url='
];

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

  async function fetchThroughProxies(targetUrl, proxyOverride) {
    const list = proxyOverride && proxyOverride.length ? proxyOverride : proxies;
    let lastErr;
    for (const proxy of list) {
      try {
        const sep = proxy.includes('?') ? '' : '?url=';
        const url = proxy + sep + encodeURIComponent(targetUrl);
        const res = await fetch(url, { headers: { 'Accept': 'text/html' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        if (!text || text.length < 200) throw new Error('Empty proxy response');
        return text;
      } catch (err) {
        lastErr = err;
      }
    }
    // Auto-fallback: if a personal Worker/custom proxy is configured, try it
    // once public proxies are exhausted (Anna's DDoS-Guard blocks shared IPs).
    if (fallbackProxy && !list.includes(fallbackProxy)) {
      try {
        const sep = fallbackProxy.includes('?') ? '' : '?url=';
        const url = fallbackProxy + sep + encodeURIComponent(targetUrl);
        const res = await fetch(url, { headers: { 'Accept': 'text/html' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        if (!text || text.length < 200) throw new Error('Empty proxy response');
        return text;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('All proxies failed');
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

  return { setProxies, setFallback, search, buildUrl, categoryToContent, DEFAULT_PROXIES };
})();

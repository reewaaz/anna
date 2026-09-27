/* search.js — mirror-aware Anna's Archive client.
 *
 * Two things this file used to get wrong, and how they are fixed:
 *
 *  1. It reported every failure as "the Worker is not deployed yet". Failures
 *     are now classified (challenge / blocked / http / network / parse) and the
 *     real reason propagates to the UI.
 *
 *  2. It assumed every upstream honoured every filter. They do not. Each mirror
 *     below declares which filters it actually supports (verified against the
 *     live site) and unsupported filters are dropped *and reported*, so the UI
 *     can disable them instead of silently returning unfiltered results.
 */

const AA_PROXY = 'https://anna-proxy.riwaj-p.workers.dev/?url=';

const Search = (() => {
  /* ---------- mirror profiles ----------
   * caps        what the mirror genuinely honours
   * paramMap    app filter -> mirror query parameter
   * sortMap     app sort value -> mirror sort value (null = no sort support)
   * formats     file extensions the mirror's own form offers
   */
  const MIRRORS = [
    {
      id: 'is',
      origin: 'https://annas-archive.is',
      label: 'annas-archive.is',
      caps: { q: true, page: true, ext: true, lang: false, sort: false, content: false, year: false },
      paramMap: { q: 'q', page: 'page', ext: 'extension' },
      sortMap: null,
      extMulti: false,
      // Formats this mirror's own `extension=` filter actually accepts
      // (read off its search form), not every format the parser can read.
      formats: ['pdf', 'epub', 'mobi', 'azw3', 'djvu', 'fb2', 'txt', 'rtf'],
      // Verified: language= returns 0 results for every value (even en),
      // sort= returns 0 results for every non-empty value, content= and
      // year_from/year_to are ignored entirely, page= and extension= work.
      notes: [
        'Language, sort order, year range and category filters are not supported by this mirror.',
        'Download links require a free Anna’s Archive account.'
      ]
    },
    {
      id: 'gl',
      origin: 'https://annas-archive.gl',
      label: 'annas-archive.gl',
      caps: { q: true, page: true, ext: true, lang: true, sort: true, content: true, year: true },
      paramMap: {
        q: 'q', page: 'page', ext: 'ext', lang: 'lang', sort: 'sort',
        content: 'content', year_from: 'year_from', year_to: 'year_to'
      },
      sortMap: null,
      extMulti: true,
      formats: ['pdf', 'epub', 'mobi', 'azw3', 'djvu', 'txt', 'cbz', 'cbr', 'fb2', 'html', 'rtf', 'zip'],
      // Currently behind a DDoS-Guard JS challenge, so every /search request
      // returns 403. Kept in the list so the app recovers automatically if the
      // challenge is lifted.
      notes: ['Currently returning a DDoS-Guard browser challenge (HTTP 403).']
    }
  ];

  let proxies = [AA_PROXY];
  let mirrors = [...MIRRORS];
  let activeMirror = MIRRORS[0];

  /* ---------- errors ---------- */
  const REASONS = {
    challenge: 'challenge',
    blocked: 'blocked',
    http: 'http',
    network: 'network',
    empty: 'empty',
    parse: 'parse',
    noMirror: 'noMirror'
  };

  class SearchError extends Error {
    constructor(reason, message, detail) {
      super(message);
      this.name = 'SearchError';
      this.reason = reason;
      this.detail = detail || {};
    }
  }

  /* ---------- proxy / mirror configuration ---------- */
  function setProxies(list) {
    if (Array.isArray(list) && list.length) proxies = list.slice();
  }
  function setProxiesFromCustom(custom) {
    const c = (custom || '').trim();
    proxies = c ? [c, ...proxies.filter((p) => p !== c)] : [AA_PROXY];
  }
  function setMirrors(list) {
    if (Array.isArray(list) && list.length) {
      mirrors = list.slice();
      activeMirror = mirrors[0];
    }
  }
  function setActiveMirror(id) {
    const m = mirrors.find((x) => x.id === id);
    if (m) {
      activeMirror = m;
      Parser.setOrigin(m.origin);
    }
    return activeMirror;
  }
  function getActiveMirror() { return activeMirror; }
  function getMirrors() { return mirrors.slice(); }
  function capabilities() {
    return { ...activeMirror.caps, mirror: activeMirror.id, formats: activeMirror.formats.slice() };
  }

  /* Which of the caller's filters this mirror cannot honour. */
  function unsupportedFilters(opts) {
    const out = [];
    const c = activeMirror.caps;
    if (opts.content && !c.content) out.push('category');
    if (opts.lang && !c.lang) out.push('language');
    if (opts.ext && !c.ext) out.push('format');
    if (opts.sort && !c.sort) out.push('sort');
    if ((opts.yearFrom || opts.yearTo) && !c.year) out.push('year');
    return out;
  }

  /* ---------- URL building ---------- */
  function buildUrl(opts, mirror) {
    const m = mirror || activeMirror;
    const p = new URLSearchParams();
    const set = (key, val) => {
      if (val === '' || val === undefined || val === null) return;
      const name = m.paramMap[key];
      if (!name) return;                     // mirror does not support it
      p.set(name, val);
    };

    set('q', opts.query);
    set('page', opts.page > 1 ? String(opts.page) : '');

    if (opts.ext && m.caps.ext) {
      const list = String(opts.ext).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const usable = list.filter((e) => m.formats.includes(e));
      if (usable.length) set('ext', m.extMulti ? usable.join(',') : usable[0]);
    }
    if (opts.lang && m.caps.lang) set('lang', opts.lang);
    if (opts.content && m.caps.content) {
      set('content', Array.isArray(opts.content) ? opts.content[0] : opts.content);
    }
    if (opts.sort && m.caps.sort) {
      set('sort', (m.sortMap && m.sortMap[opts.sort]) || opts.sort);
    }
    if (m.caps.year) {
      set('year_from', opts.yearFrom);
      set('year_to', opts.yearTo);
    }
    return `${m.origin}/search?${p.toString()}`;
  }

  /* ---------- transport ---------- */
  function proxyUrl(proxy, targetUrl) {
    const sep = proxy.includes('?') ? '' : '?url=';
    return proxy + sep + encodeURIComponent(targetUrl);
  }

  function looksLikeChallenge(text) {
    return /DDoS-Guard|ddos-guard|check\.ddos-guard\.net|Checking your browser/i.test(text.slice(0, 6000));
  }

  async function fetchViaProxy(proxy, targetUrl, signal) {
    const url = proxyUrl(proxy, targetUrl);
    let res;
    try {
      res = await fetch(url, { headers: { 'Accept': 'text/html' }, signal });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new SearchError(REASONS.network, 'Could not reach the proxy.', {
        proxy, target: targetUrl, cause: String(err && err.message || err)
      });
    }

    const challengeHeader = res.headers.get('x-anna-challenge') === '1';
    const upstreamHost = res.headers.get('x-anna-upstream-host') || '';

    let text = '';
    try {
      text = await res.text();
    } catch (err) {
      throw new SearchError(REASONS.network, 'Proxy response could not be read.', {
        proxy, target: targetUrl, cause: String(err && err.message || err)
      });
    }

    if (challengeHeader || (looksLikeChallenge(text) && !res.ok)) {
      throw new SearchError(
        REASONS.challenge,
        'Anna’s Archive is showing a bot-protection challenge instead of results.',
        { host: upstreamHost, status: res.status, proxy }
      );
    }
    if (res.status === 403 || res.status === 401) {
      throw new SearchError(REASONS.blocked, 'Anna’s Archive refused the request.', {
        host: upstreamHost, status: res.status, proxy
      });
    }
    if (!res.ok) {
      throw new SearchError(REASONS.http, 'Upstream returned an error.', {
        host: upstreamHost, status: res.status, proxy
      });
    }
    // A 200 that is really a challenge page (some CDNs answer 200 then swap in
    // the interstitial) must not be mistaken for a result page.
    if (challengeHeader || looksLikeChallenge(text)) {
      throw new SearchError(REASONS.challenge,
        'Anna’s Archive is showing a bot-protection challenge instead of results.',
        { host: upstreamHost, status: res.status, proxy });
    }
    if (!text || text.length < 2000) {
      throw new SearchError(REASONS.empty, 'Upstream returned an empty or stub page.', {
        host: upstreamHost, status: res.status, bytes: text ? text.length : 0, proxy
      });
    }
    return text;
  }

  async function fetchMirrorHtml(mirror, url, signal) {
    let last;
    for (const proxy of proxies) {
      try {
        return { html: await fetchViaProxy(proxy, url, signal), proxy };
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        last = err;
      }
    }
    throw last || new SearchError(REASONS.network, 'No proxy configured.', {});
  }

  /* ---------- public: search ---------- */
  async function search(opts) {
    const options = Object.assign({ page: 1 }, opts);
    const dropped = unsupportedFilters(options);
    const attempts = [];

    for (const mirror of mirrors) {
      const url = buildUrl(options, mirror);
      try {
        const { html, proxy } = await fetchMirrorHtml(mirror, url);
        const results = Parser.parse(html);
        if (!results.length) {
          // A page that parsed to nothing is a frontend change, not a failure
          // of the network path — record it and try the next mirror.
          attempts.push({ mirror: mirror.id, reason: REASONS.parse, proxy, bytes: html.length });
          continue;
        }
        setActiveMirror(mirror.id);
        return {
          results,
          mirror: mirror.id,
          mirrorLabel: mirror.label,
          url,
          droppedFilters: dropped,
          notes: mirror.notes || []
        };
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        attempts.push({
          mirror: mirror.id,
          reason: (err && err.reason) || REASONS.http,
          message: err && err.message,
          detail: (err && err.detail) || {}
        });
      }
    }

    throw new SearchError(
      attempts.length ? attempts[0].reason : REASONS.noMirror,
      describeFailure(attempts),
      { attempts }
    );
  }

  function describeFailure(attempts) {
    if (!attempts.length) return 'No mirrors are configured.';
    const parts = attempts.map((a) => {
      switch (a.reason) {
        case REASONS.challenge:
          return `${a.mirror}: bot-protection challenge`;
        case REASONS.blocked:
          return `${a.mirror}: refused (HTTP ${a.detail.status})`;
        case REASONS.http:
          return `${a.mirror}: HTTP ${a.detail.status}`;
        case REASONS.empty:
          return `${a.mirror}: empty response`;
        case REASONS.parse:
          return `${a.mirror}: unrecognised page layout`;
        case REASONS.network:
          return `${a.mirror}: unreachable`;
        default:
          return `${a.mirror}: failed`;
      }
    });
    return parts.join(' · ');
  }

  /* Human-facing explanation for a failure. No more "run wrangler deploy" —
     that advice was the original bug, not a diagnosis. */
  function explain(err) {
    if (!err) return 'Search failed for an unknown reason.';
    const reason = err.reason;
    const detail = err.detail || {};
    const attempts = detail.attempts || [];
    const challenged = attempts.some((a) => a.reason === REASONS.challenge);
    const refused = attempts.some((a) => a.reason === REASONS.blocked);
    // Collect statuses from the per-mirror attempts and from the error's own
    // detail, so a single-mirror failure still reports its status code.
    const codes = attempts
      .map((a) => a.detail && a.detail.status)
      .filter(Boolean)
      .concat(detail.status ? [detail.status] : []);

    if (reason === REASONS.challenge || challenged) {
      return 'Anna’s Archive is blocking automated requests to /search with a bot-protection ' +
        'challenge, so results cannot be fetched. The proxy Worker is running fine — this is an ' +
        'upstream block, not a deployment problem.';
    }
    if (reason === REASONS.blocked || refused) {
      // Surface the upstream status: the whole point of the fix is that the UI
      // reports what actually happened instead of guessing at the cause.
      return 'Anna’s Archive refused the request' +
        (codes.length ? ` (HTTP ${[...new Set(codes)].join(', ')})` : '') +
        '. The proxy is reachable; the upstream is declining automated traffic.';
    }
    if (reason === REASONS.parse) {
      return 'The proxy and upstream responded, but the results page layout was not recognised. ' +
        'Anna’s Archive has probably changed its HTML.';
    }
    if (reason === REASONS.empty) {
      return 'The upstream mirror returned an empty page. That mirror is probably offline.';
    }
    if (reason === REASONS.network) {
      return 'Could not reach the proxy. Check your connection, or set a custom proxy in Settings.';
    }
    return 'Search failed: ' + (err.message || 'unknown error');
  }

  /* ---------- helpers used by the viewer / downloads modal ---------- */
  function proxiedUrl(target) {
    const p = proxies[0] || AA_PROXY;
    return proxyUrl(p, target);
  }

  async function fetchProxied(target) {
    return fetchViaProxy(proxies[0] || AA_PROXY, target);
  }

  Parser.setOrigin(activeMirror.origin);

  return {
    MIRRORS,
    AA_PROXY,
    setProxies,
    setProxiesFromCustom,
    setMirrors,
    setActiveMirror,
    getActiveMirror,
    getMirrors,
    capabilities,
    unsupportedFilters,
    buildUrl,
    search,
    explain,
    proxiedUrl,
    fetchProxied,
    SearchError
  };
})();

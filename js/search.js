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
      // Sort order and year range are ignored upstream, but every card this
      // mirror returns carries the fields needed to apply them in the browser
      // (title always, file size on 100% of cards, year on ~70%). They are
      // therefore listed in `local` and honoured client-side instead of being
      // dropped. Language is NOT in that list: upstream returns zero results
      // for every language= value, and the cards carry no language field at
      // all (0% coverage), so there is nothing to filter on.
      local: ['sort', 'year'],
      // Formats this mirror's own `extension=` filter actually accepts
      // (read off its search form), not every format the parser can read.
      formats: ['pdf', 'epub', 'mobi', 'azw3', 'djvu', 'fb2', 'txt', 'rtf'],
      // Measured against the live mirror, not assumed:
      //   extension=pdf -> 20/20 pdf          honoured
      //   page=2        -> page 2 loads       honoured
      //   sort=title    -> 20 results, byte-identical order to no sort  ignored
      //   sort=oldest|largest|smallest -> 0 results                      broken
      //   language=en|de|... -> 0 results                               broken
      //   content=magazines -> still 20 "Books catalog" cards            ignored
      //   year_from=1990 -> still returns a 1982 book                   ignored
      notes: [
        'Sorting and year range are applied in your browser to the results on this page — the mirror ignores both upstream.',
        'Language and category filters are not available: the mirror returns no results for them.',
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
      local: [],
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
      syncParserOrigin();
    }
    return activeMirror;
  }
  function getActiveMirror() { return activeMirror; }
  function getMirrors() { return mirrors.slice(); }

  // A capability is one of:
  //   true   -> the mirror honours it upstream; send it as a query parameter
  //   'local'-> upstream ignores it, but the app can honour it in the browser
  //             from the metadata on the cards, so it is NOT dropped
  //   false  -> nothing can honour it; the control is disabled with a reason
  function localCaps() { return (activeMirror.local || []).slice(); }
  function isHonourable(cap) {
    const v = activeMirror.caps[cap];
    return v === true || v === 'local';
  }
  function isLocal(cap) { return (activeMirror.local || []).includes(cap); }
  function capabilities() {
    return {
      ...activeMirror.caps,
      mirror: activeMirror.id,
      formats: activeMirror.formats.slice(),
      local: localCaps()
    };
  }

  /* Which of the caller's filters this mirror cannot honour at all. Filters
     listed in `local` are deliberately absent: they are applied client-side. */
  function unsupportedFilters(opts) {
    const out = [];
    const c = activeMirror.caps;
    if (opts.content && !c.content) out.push('category');
    if (opts.lang && !c.lang) out.push('language');
    if (opts.ext && !c.ext) out.push('format');
    if (opts.sort && !c.sort && !isLocal('sort')) out.push('sort');
    if ((opts.yearFrom || opts.yearTo) && !c.year && !isLocal('year')) out.push('year');
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
    // Only send sort/year when the mirror honours them upstream. A 'local'
    // capability is applied in the browser, and sending it anyway would be
    // pointless at best and actively harmful at worst — this mirror returns
    // *zero* results for sort=oldest, sort=largest, sort=smallest and for
    // every language= value.
    if (opts.sort && m.caps.sort === true) {
      set('sort', (m.sortMap && m.sortMap[opts.sort]) || opts.sort);
    }
    if (m.caps.year === true) {
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

  /* Distinguishes "this query has no matches" from "the parser no longer
     understands this page".

     Both look identical to the parser: zero cards. Treating a genuinely empty
     result set as a parse failure reported a scary upstream error for an
     ordinary search that simply found nothing, which is what produced
     "(is: parse, gl: challenge)" for queries with no hits.

     A real results page always carries the mirror's own search form and a
     "Search results for ..." heading, even when the result list is empty. */
  function looksLikeResultsPage(html) {
    if (!html) return false;
    if (looksLikeChallenge(html)) return false;
    if (/Search results for/i.test(html)) return true;
    return /<form[^>]+action="[^"]*\/search/i.test(html);
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
          // Zero cards is only a *parse* failure if the page is not a results
          // page at all. When it is one, the query genuinely has no matches
          // and that is a successful search with an empty list — reporting it
          // as an error is what made ordinary no-hit searches look broken.
          if (!looksLikeResultsPage(html)) {
            attempts.push({ mirror: mirror.id, reason: REASONS.parse, proxy, bytes: html.length });
            continue;
          }
          setActiveMirror(mirror.id);
          return {
            results: [],
            noMatches: true,
            mirror: mirror.id,
            mirrorLabel: mirror.label,
            url,
            droppedFilters: dropped,
            notes: mirror.notes || []
          };
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

  /* ---------- client-side sorting and year filtering ----------

     The live mirror ignores `sort=` and `year_from`/`year_to` upstream, and
     three of its four sort values return zero results. The cards it does
     return, however, carry everything needed to order and year-filter them
     here: title on 100%, file size on 100%, year on ~70%.

     This sorts and filters the results currently loaded on the page. It does
     not reorder the whole corpus — the app says so in the mirror note rather
     than implying a global sort. */

  const SIZE_UNITS = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };

  // "1B", "1.1MB", "12.4 MB", "1.1 GB" -> bytes. Returns null when unknown,
  // so an unparseable size sorts last instead of being treated as 0 bytes.
  function parseSize(text) {
    if (!text) return null;
    const m = String(text).replace(/,/g, '').match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!isFinite(n)) return null;
    const unit = SIZE_UNITS[m[2].toUpperCase()];
    return unit ? Math.round(n * unit) : null;
  }

  function yearOf(item) {
    const y = parseInt(String(item && item.year || ''), 10);
    return isFinite(y) && y > 0 ? y : null;
  }

  // Unknown values always sort last, in both directions, so a card with no
  // year never masquerades as the oldest or the newest.
  function byNumeric(get, dir) {
    return (a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av === bv) return 0;
      return av < bv ? -dir : dir;
    };
  }

  function sortResults(list, mode) {
    const items = (list || []).slice();
    switch (mode) {
      case 'title':
        return items.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }));
      case 'title_desc':
        return items.sort((a, b) => String(b.title || '').localeCompare(String(a.title || ''), undefined, { sensitivity: 'base' }));
      case 'newest':
        return items.sort(byNumeric(yearOf, -1));
      case 'oldest':
        return items.sort(byNumeric(yearOf, 1));
      case 'largest':
        return items.sort(byNumeric((x) => parseSize(x.size), -1));
      case 'smallest':
        return items.sort(byNumeric((x) => parseSize(x.size), 1));
      case 'random': {
        // Deterministic per call site would be nicer, but shuffle-on-render
        // means re-sorting visibly reshuffles, which is the point of Random.
        for (let i = items.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = items[i]; items[i] = items[j]; items[j] = t;
        }
        return items;
      }
      default:
        // '' (relevance), plus the mirror's "newest added"/"oldest added",
        // which no card exposes. Upstream order is the honest fallback.
        return items;
    }
  }

  /* Year range, applied in the browser. Cards with no year are excluded when a
     bound is set, because there is no way to prove they fall inside it — and
     the caller is told how many were undecidable so the UI can say so rather
     than quietly dropping ~30% of results. */
  function filterByYear(list, from, to) {
    const bound = (v) => {
      if (v === '' || v === undefined || v === null) return null;
      const n = parseInt(v, 10);
      // isFinite(null) is true, so a missing bound must be rejected before the
      // numeric check or an empty range silently filters every unknown year out.
      return Number.isFinite(n) ? n : null;
    };
    const low = bound(from);
    const high = bound(to);
    if (low === null && high === null) {
      const all = (list || []).slice();
      return { items: all, kept: all.length, unknownYear: 0, active: false };
    }
    const items = [];
    let unknownYear = 0;
    for (const it of list || []) {
      const y = yearOf(it);
      if (y === null) { unknownYear++; continue; }
      if (low !== null && y < low) continue;
      if (high !== null && y > high) continue;
      items.push(it);
    }
    return { items, kept: items.length, unknownYear, active: true };
  }

  /* ---------- helpers used by the viewer / downloads modal ---------- */
  function proxiedUrl(target) {
    const p = proxies[0] || AA_PROXY;
    return proxyUrl(p, target);
  }

  async function fetchProxied(target) {
    return fetchViaProxy(proxies[0] || AA_PROXY, target);
  }

  // NOTE: this module is loaded *before* parser.js in index.html, so Parser
  // does not exist yet at this point. Touching it here threw
  // "ReferenceError: Parser is not defined", which killed the whole script and
  // left the app stuck on "Searching…" with no results. setOrigin() is called
  // from setActiveMirror() (which runs after both modules are loaded) instead.
  function syncParserOrigin() {
    if (typeof Parser !== 'undefined' && Parser && typeof Parser.setOrigin === 'function') {
      Parser.setOrigin(activeMirror.origin);
    }
  }

  // Called by app.js once every module is loaded, to establish the initial
  // parser origin without depending on script evaluation order.
  function init() {
    syncParserOrigin();
  }

  return {
    MIRRORS,
    AA_PROXY,
    init,
    setProxies,
    setProxiesFromCustom,
    setMirrors,
    setActiveMirror,
    getActiveMirror,
    getMirrors,
    capabilities,
    isHonourable,
    isLocal,
    localCaps,
    unsupportedFilters,
    buildUrl,
    search,
    explain,
    parseSize,
    sortResults,
    filterByYear,
    proxiedUrl,
    fetchProxied,
    SearchError
  };
})();

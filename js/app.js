/* app.js — UI wiring: search, tabs, filters, settings, results, viewer. */

(() => {
  const state = {
    query: '',
    category: 'top',
    page: 1,
    results: [],
    loading: false
  };

  const els = {
    form: document.getElementById('search-form'),
    input: document.getElementById('search-input'),
    advancedToggle: document.getElementById('advanced-toggle'),
    advancedPanel: document.getElementById('advanced-panel'),
    tabs: Array.from(document.querySelectorAll('.tab')),
    results: document.getElementById('results'),
    status: document.getElementById('status'),
    loadMoreWrap: document.getElementById('load-more-wrap'),
    loadMore: document.getElementById('load-more'),
    settingsToggle: document.getElementById('settings-toggle'),
    settings: document.getElementById('settings'),
    settingsSave: document.getElementById('settings-save'),
    settingsClose: document.getElementById('settings-close'),
    sProxy: document.getElementById('s-proxy'),
    sProxyCustom: document.getElementById('s-proxy-custom')
  };

  const LS_PROXY = 'anna.proxy.custom';

  function showStatus(msg, isError) {
    els.status.hidden = false;
    els.status.textContent = msg;
    els.status.classList.toggle('error', !!isError);
  }
  function hideStatus() {
    els.status.hidden = true;
  }

  function currentFilters() {
    return {
      lang: document.getElementById('f-lang').value.trim(),
      ext: document.getElementById('f-ext').value.trim(),
      sort: document.getElementById('f-sort').value,
      yearFrom: document.getElementById('f-year-from').value.trim(),
      yearTo: document.getElementById('f-year-to').value.trim()
    };
  }

  function applyProxy() {
    const custom = (localStorage.getItem(LS_PROXY) || '').trim();
    // Always try the public proxy list first; auto-fall back to a personal
    // Worker (custom proxy) when Anna's DDoS-Guard blocks the shared IPs.
    Search.setProxies(Search.DEFAULT_PROXIES);
    Search.setFallback(custom);
  }

  function renderCards(list) {
    for (const r of list) {
      const card = document.createElement('article');
      card.className = 'card';
      card.tabIndex = 0;

      const cover = document.createElement(r.cover ? 'img' : 'div');
      if (r.cover) {
        cover.className = 'cover';
        cover.loading = 'lazy';
        cover.src = r.cover;
        cover.alt = r.title;
        cover.onerror = () => {
          cover.replaceWith(makeMissingCover(r.title));
        };
      } else {
        cover.replaceWith(makeMissingCover(r.title));
        continue;
      }

      const body = document.createElement('div');
      body.className = 'body';

      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = r.title;

      const meta = document.createElement('div');
      meta.className = 'meta';
      const badges = [r.ext && r.ext.toUpperCase(), r.size, r.year, r.authors && r.authors.slice(0, 40)];
      for (const b of badges) {
        if (!b) continue;
        const span = document.createElement('span');
        span.className = 'badge';
        span.textContent = b;
        meta.appendChild(span);
      }

      body.appendChild(title);
      if (meta.children.length) body.appendChild(meta);
      card.appendChild(cover);
      card.appendChild(body);

      const open = () => Viewer.open(r.href, r.title);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });

      els.results.appendChild(card);
    }
  }

  function makeMissingCover(title) {
    const div = document.createElement('div');
    div.className = 'cover missing';
    div.textContent = (title || 'No cover').slice(0, 24);
    return div;
  }

  async function doSearch(reset = true) {
    const query = els.input.value.trim();
    if (!query) return;
    state.query = query;
    if (reset) {
      state.page = 1;
      state.results = [];
      els.results.innerHTML = '';
      els.loadMoreWrap.hidden = true;
    }
    state.loading = true;
    showStatus('Searching Anna’s Archive…');

    try {
      const filters = currentFilters();
      const results = await Search.search({
        query,
        category: state.category,
        lang: filters.lang,
        ext: filters.ext,
        sort: filters.sort,
        yearFrom: filters.yearFrom,
        yearTo: filters.yearTo,
        page: state.page
      });

      if (reset && results.length === 0) {
        showStatus('No results found. Try broadening your filters.');
      } else {
        hideStatus();
      }
      state.results = state.results.concat(results);
      renderCards(results);
      els.loadMoreWrap.hidden = results.length < 1;
    } catch (err) {
      showStatus('Search failed: ' + (err && err.message ? err.message : err) +
        '. The proxy may be blocked — try another in Settings.', true);
    } finally {
      state.loading = false;
    }
  }

  function setCategory(cat) {
    state.category = cat;
    els.tabs.forEach((t) => t.classList.toggle('active', t.dataset.category === cat));
    if (state.query) doSearch(true);
  }

  // Events
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    doSearch(true);
  });

  els.advancedToggle.addEventListener('click', () => {
    const open = els.advancedPanel.hidden;
    els.advancedPanel.hidden = !open;
    els.advancedToggle.setAttribute('aria-expanded', String(open));
  });

  els.tabs.forEach((t) => {
    t.addEventListener('click', () => setCategory(t.dataset.category));
  });

  els.loadMore.addEventListener('click', () => {
    if (state.loading) return;
    state.page += 1;
    doSearch(false);
  });

  // Settings
  els.settingsToggle.addEventListener('click', () => {
    els.sProxyCustom.value = localStorage.getItem(LS_PROXY) || '';
    els.settings.hidden = false;
  });
  els.settingsClose.addEventListener('click', () => { els.settings.hidden = true; });
  els.settingsSave.addEventListener('click', () => {
    const v = els.sProxyCustom.value.trim();
    if (v) localStorage.setItem(LS_PROXY, v);
    else localStorage.removeItem(LS_PROXY);
    applyProxy();
    els.settings.hidden = true;
  });

  applyProxy();
  Viewer.init();
})();

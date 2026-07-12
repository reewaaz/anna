/* app.js — UI wiring: search, pill nav, filters sheet, onboarding, install. */

(() => {
  const LS_ONBOARDED = 'anna.onboarded';
  const LS_PROXY = 'anna.proxy.custom';
  const LS_INSTALL_DISMISSED = 'anna.install.dismissed';
  const LS_VIEW = 'anna.view';
  const LS_THEME = 'anna.theme';
  const DAILY_TOPICS = ['science', 'history', 'programming', 'fiction', 'philosophy', 'art', 'mathematics'];

  const state = {
    query: '',
    category: 'book_any',
    page: 1,
    results: [],
    loading: false
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    form: $('search-form'),
    input: $('search-input'),
    clearBtn: $('clear-btn'),
    advancedToggle: $('advanced-toggle'),
    advancedPanel: $('advanced-panel'),
    advancedClose: $('advanced-close'),
    advancedClear: $('advanced-clear'),
    advancedApply: $('advanced-apply'),
    presets: $('presets'),
    extChips: $('ext-chips'),
    tabs: Array.from(document.querySelectorAll('.cat-nav .tab')),
    results: $('results'),
    welcome: $('welcome'),
    status: $('status'),
    resultsToolbar: $('results-toolbar'),
    resultsCount: $('results-count'),
    sortSelect: $('sort-select'),
    loadMoreWrap: $('load-more-wrap'),
    loadMore: $('load-more'),
    settingsToggle: $('settings-toggle'),
    settings: $('settings'),
    settingsSave: $('settings-save'),
    settingsClose: $('settings-close'),
    sProxyCustom: $('s-proxy-custom'),
    viewGrid: $('view-grid'),
    viewList: $('view-list'),
    themeToggle: $('theme-toggle'),
    downloads: $('downloads'),
    downloadsTitle: $('downloads-title'),
    downloadsSub: $('downloads-sub'),
    downloadsList: $('downloads-list'),
    downloadsStatus: $('downloads-status'),
    downloadsClose: $('downloads-close'),
    downloadsPage: $('downloads-page'),
    onboard: $('onboard'),
    onboardClose: $('onboard-close'),
    onboardInstall: $('onboard-install'),
    installBanner: $('install-banner'),
    ibInstall: $('ib-install'),
    ibDismiss: $('ib-dismiss'),
    installBtn: $('install-btn')
  };

  let deferredPrompt = null;

  function showStatus(msg, isError) {
    els.status.hidden = false;
    els.status.textContent = msg;
    els.status.classList.toggle('error', !!isError);
  }
  function hideStatus() { els.status.hidden = true; }

  function currentFilters() {
    return {
      lang: $('f-lang').value.trim(),
      ext: $('f-ext').value.trim(),
      sort: $('f-sort').value,
      yearFrom: $('f-year-from').value.trim(),
      yearTo: $('f-year-to').value.trim()
    };
  }

  function applyProxy() {
    const custom = (localStorage.getItem(LS_PROXY) || '').trim();
    Search.setFallback(custom);
    if (custom) {
      Search.setProxies([custom, ...Search.DEFAULT_PROXIES]);
      return;
    }
    Search.setProxies([...Search.DEFAULT_PROXIES]);
    Search.detectWorkingProxy().then((best) => {
      if (best && best !== Search.DEFAULT_PROXIES[0]) {
        Search.setProxies([best, ...Search.DEFAULT_PROXIES.filter((p) => p !== best)]);
      }
    });
  }

  function renderCards(list) {
    for (const r of list) {
      const card = document.createElement('article');
      card.className = 'card';
      card.tabIndex = 0;

      let coverEl;
      if (r.cover) {
        coverEl = document.createElement('img');
        coverEl.className = 'cover';
        coverEl.loading = 'lazy';
        coverEl.referrerPolicy = 'no-referrer';
        coverEl.src = r.cover;
        coverEl.alt = r.title;
        coverEl.onerror = () => coverEl.replaceWith(makeMissingCover(r.title));
      } else {
        coverEl = makeMissingCover(r.title);
      }

      const body = document.createElement('div');
      body.className = 'body';

      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = r.title;

      if (r.authors) {
        const author = document.createElement('div');
        author.className = 'author';
        author.textContent = r.authors;
        body.appendChild(author);
      }

      if (r.type) {
        const typeEl = document.createElement('div');
        typeEl.className = 'doc-type';
        typeEl.textContent = r.type;
        body.appendChild(typeEl);
      }

      const meta = document.createElement('div');
      meta.className = 'meta';
      const badges = [
        r.ext && r.ext.toUpperCase(),
        r.size,
        r.year,
        r.lang && r.lang.toUpperCase()
      ];
      for (const b of badges) {
        if (!b) continue;
        const span = document.createElement('span');
        span.className = 'badge' + (b === r.ext.toUpperCase() ? ' accent' : '');
        span.textContent = b;
        meta.appendChild(span);
      }

      body.appendChild(title);
      if (meta.children.length) body.appendChild(meta);
      card.appendChild(coverEl);
      card.appendChild(body);

      const open = () => openDownloads(r);
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
    div.textContent = (title || 'No cover').slice(0, 28);
    return div;
  }

  function updateToolbar() {
    const has = state.results.length > 0;
    els.resultsToolbar.hidden = !has;
    els.resultsCount.textContent = has
      ? state.results.length + (state.results.length === 1 ? ' result' : ' results')
      : '';
  }

  async function doSearch(reset = true) {
    const query = els.input.value.trim() || state.query;
    if (!query) return;
    state.query = query;
    if (reset) {
      state.page = 1;
      state.results = [];
      els.results.innerHTML = '';
      els.welcome.hidden = true;
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
      updateToolbar();
    } catch (err) {
      showStatus('Search failed. The proxy Worker (anna.riwaj-p.workers.dev) may be down or not deployed yet. ' +
        'Deploy it with: cd worker && wrangler deploy  (see worker/README).', true);
    } finally {
      state.loading = false;
    }
  }

  function setCategory(cat) {
    state.category = cat;
    els.tabs.forEach((t) => t.classList.toggle('active', t.dataset.category === cat));
    if (state.query) doSearch(true);
    else showStatus('Type a search above, then use these tabs to filter.', false);
  }

  /* ---------- View mode (grid / list) ---------- */
  function applyView(mode) {
    const list = mode === 'list';
    els.results.classList.toggle('results-list', list);
    els.results.classList.toggle('results-grid', !list);
    els.viewGrid.classList.toggle('active', !list);
    els.viewList.classList.toggle('active', list);
    localStorage.setItem(LS_VIEW, mode);
  }
  function setupViewToggle() {
    const saved = localStorage.getItem(LS_VIEW) || 'grid';
    applyView(saved);
    els.viewGrid.addEventListener('click', () => applyView('grid'));
    els.viewList.addEventListener('click', () => applyView('list'));
  }

  /* ---------- Theme (dark / light) ---------- */
  function applyTheme(theme) {
    const light = theme === 'light';
    document.documentElement.classList.toggle('light', light);
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', light ? '#f4f5fb' : '#0b0d14');
    els.themeToggle.classList.toggle('active', light);
    localStorage.setItem(LS_THEME, theme);
  }
  function setupThemeToggle() {
    const saved = localStorage.getItem(LS_THEME) || 'dark';
    applyTheme(saved);
    els.themeToggle.addEventListener('click', () => {
      const isLight = document.documentElement.classList.contains('light');
      applyTheme(isLight ? 'dark' : 'light');
    });
  }

  function goHome() {
    Viewer.close();
    els.input.value = '';
    els.clearBtn.hidden = true;
    attemptDefaultBrowse();
  }

  /* ---------- Downloads ---------- */
  function showDownloadsStatus(msg, isError) {
    els.downloadsStatus.hidden = false;
    els.downloadsStatus.textContent = msg;
    els.downloadsStatus.classList.toggle('error', !!isError);
  }
  function hideDownloadsStatus() { els.downloadsStatus.hidden = true; }

  async function openDownloads(r) {
    els.downloads.hidden = false;
    els.downloadsTitle.textContent = r.title || 'Downloads';
    els.downloadsSub.textContent = [r.type, r.authors, r.ext && r.ext.toUpperCase(), r.size, r.year]
      .filter(Boolean).join('  ·  ');
    els.downloadsList.innerHTML = '';
    els.downloadsPage.href = r.href || '#';
    showDownloadsStatus('Loading download links…');

    try {
      const url = Search.proxiedUrl(r.href);
      const res = await fetch(url, { headers: { 'Accept': 'text/html' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const links = Parser.parseDownloads(text);
      if (!links.length) throw new Error('No download links found');
      renderDownloadLinks(links);
      hideDownloadsStatus();
    } catch (_) {
      showDownloadsStatus('Could not load download links. The proxy may be busy — try again, or use “Open on Anna’s”.', true);
    }
  }

  function renderDownloadLinks(links) {
    els.downloadsList.innerHTML = '';
    for (const link of links) {
      const a = document.createElement('a');
      a.className = 'dl-link';
      a.href = link.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = link.label;
      els.downloadsList.appendChild(a);
    }
  }

  function closeDownloads() { els.downloads.hidden = true; }

  /* Front page: load today's top books & articles (cached per day). */
  function dayStr() { return new Date().toISOString().slice(0, 10); }
  async function attemptDefaultBrowse() {
    const topic = DAILY_TOPICS[Math.floor(Date.now() / 86400000) % DAILY_TOPICS.length];
    state.query = topic;
    state.category = 'top';
    state.page = 1;
    state.results = [];
    els.results.innerHTML = '';
    els.welcome.hidden = true;
    els.loadMoreWrap.hidden = true;
    $('f-sort').value = 'newest_added';
    els.sortSelect.value = 'newest_added';
    showStatus('Loading today’s top books & articles…');

    const cacheKey = 'anna.home.' + dayStr() + '.top';
    let results;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        results = JSON.parse(cached);
      } else {
        results = await Search.search({ query: topic, category: 'top', sort: 'newest_added', page: 1 });
        if (results.length) localStorage.setItem(cacheKey, JSON.stringify(results));
      }
    } catch (_) {
      results = [];
    }

    if (results && results.length) {
      state.results = results;
      renderCards(results);
      hideStatus();
      els.loadMoreWrap.hidden = results.length < 1;
      updateToolbar();
    } else {
      els.welcome.hidden = false;
      hideStatus();
      updateToolbar();
    }
  }

  /* ---------- Filters sheet ---------- */
  function openSheet() {
    els.advancedPanel.hidden = false;
    els.advancedToggle.setAttribute('aria-expanded', 'true');
  }
  function closeSheet() {
    els.advancedPanel.hidden = true;
    els.advancedToggle.setAttribute('aria-expanded', 'false');
  }

  /* ---------- Install prompt ---------- */
  function setupInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      els.installBtn.hidden = false;
      if (!localStorage.getItem(LS_INSTALL_DISMISSED) && !localStorage.getItem(LS_ONBOARDED)) {
        // shown via onboarding instead
      } else if (!localStorage.getItem(LS_INSTALL_DISMISSED)) {
        els.installBanner.hidden = false;
      }
      els.onboardInstall.hidden = false;
    });

    const promptInstall = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      els.installBtn.hidden = true;
      els.installBanner.hidden = true;
      els.onboardInstall.hidden = true;
    };
    els.installBtn.addEventListener('click', promptInstall);
    els.ibInstall.addEventListener('click', promptInstall);
    els.onboardInstall.addEventListener('click', promptInstall);
    els.ibDismiss.addEventListener('click', () => {
      els.installBanner.hidden = true;
      localStorage.setItem(LS_INSTALL_DISMISSED, '1');
    });
    window.addEventListener('appinstalled', () => {
      els.installBtn.hidden = true;
      els.installBanner.hidden = true;
    });
  }

  /* ---------- Onboarding ---------- */
  function maybeOnboard() {
    if (!localStorage.getItem(LS_ONBOARDED)) {
      els.onboard.hidden = false;
    }
  }

  /* ---------- Wire events ---------- */
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    doSearch(true);
  });

  els.input.addEventListener('input', () => {
    els.clearBtn.hidden = els.input.value.length === 0;
  });
  els.clearBtn.addEventListener('click', () => {
    els.input.value = '';
    els.clearBtn.hidden = true;
    els.input.focus();
  });

  els.advancedToggle.addEventListener('click', openSheet);
  els.advancedClose.addEventListener('click', closeSheet);
  els.advancedPanel.addEventListener('click', (e) => { if (e.target === els.advancedPanel) closeSheet(); });
  els.advancedApply.addEventListener('click', () => { closeSheet(); els.sortSelect.value = $('f-sort').value; if (state.query) doSearch(true); });
  els.advancedClear.addEventListener('click', () => {
    $('f-content').value = '';
    $('f-lang').value = '';
    $('f-sort').value = '';
    els.sortSelect.value = '';
    $('f-ext').value = '';
    $('f-year-from').value = '';
    $('f-year-to').value = '';
    els.presets.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    els.extChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  });

  els.presets.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    $('f-content').value = btn.dataset.content;
    els.presets.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === btn));
    if (state.query) doSearch(true);
  });

  els.extChips.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    btn.classList.toggle('active');
    const sel = Array.from(els.extChips.querySelectorAll('.chip.active')).map((c) => c.dataset.ext);
    $('f-ext').value = sel.join(',');
  });

  els.tabs.forEach((t) => t.addEventListener('click', () => setCategory(t.dataset.category)));

  els.sortSelect.addEventListener('change', () => {
    $('f-sort').value = els.sortSelect.value;
    if (state.query) doSearch(true);
  });

  els.loadMore.addEventListener('click', () => {
    if (state.loading) return;
    state.page += 1;
    doSearch(false);
  });

  // Brand / logo → home
  const brand = $('brand');
  brand.addEventListener('click', goHome);
  brand.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); }
  });

  // Welcome category cards → set category + focus search
  els.welcome.querySelectorAll('.wcat').forEach((w) => {
    w.addEventListener('click', () => {
      setCategory(w.dataset.category);
      els.input.focus();
    });
  });

  // Settings (optional)
  els.settingsToggle.addEventListener('click', () => {
    els.sProxyCustom.value = localStorage.getItem(LS_PROXY) || '';
    els.settings.hidden = false;
  });
  function closeSettings() { els.settings.hidden = true; }
  els.settingsClose.addEventListener('click', closeSettings);
  els.settings.addEventListener('click', (e) => { if (e.target === els.settings) closeSettings(); });
  els.downloadsClose.addEventListener('click', closeDownloads);
  els.downloads.addEventListener('click', (e) => { if (e.target === els.downloads) closeDownloads(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.settings.hidden) closeSettings();
      else if (!els.downloads.hidden) closeDownloads();
      else if (!els.advancedPanel.hidden) closeSheet();
      else if (!els.onboard.hidden) els.onboard.hidden = true;
    }
  });
  els.settingsSave.addEventListener('click', () => {
    const v = els.sProxyCustom.value.trim();
    if (v) localStorage.setItem(LS_PROXY, v);
    else localStorage.removeItem(LS_PROXY);
    applyProxy();
    closeSettings();
  });
  $('settings-reset').addEventListener('click', () => {
    localStorage.removeItem(LS_PROXY);
    els.sProxyCustom.value = '';
    applyProxy();
    closeSettings();
  });

  // Onboarding close
  els.onboardClose.addEventListener('click', () => {
    localStorage.setItem(LS_ONBOARDED, '1');
    els.onboard.hidden = true;
  });

  applyProxy();
  setupInstall();
  setupViewToggle();
  setupThemeToggle();
  maybeOnboard();
  attemptDefaultBrowse();
  Viewer.init();
})();

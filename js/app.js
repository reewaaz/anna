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
    category: 'fiction',
    page: 1,
    results: [],
    loading: false
  };

  let currentItem = null;
  let currentItemHtml = '';

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
    viewGrid: $('view-grid'),
    viewList: $('view-list'),
    themeToggle: $('theme-toggle'),
    downloads: $('downloads'),
    downloadsTitle: $('downloads-title'),
    downloadsSub: $('downloads-sub'),
    downloadsCover: $('downloads-cover'),
    downloadsList: $('downloads-list'),
    downloadsStatus: $('downloads-status'),
    downloadsClose: $('downloads-close'),
    downloadsPage: $('downloads-page'),
    downloadsDescBtn: $('downloads-desc-btn'),
    downloadsDesc: $('downloads-desc'),
    typeSelect: $('type-select'),
    onboard: $('onboard'),
    onboardClose: $('onboard-close'),
    onboardInstall: $('onboard-install'),
    onboardSkip: $('onboard-skip'),
    onboardBack: $('onboard-back'),
    onboardNext: $('onboard-next'),
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
    Search.setProxiesFromCustom(custom);
    syncCapabilities();
  }

  /* Disable (and explain) any filter the active upstream mirror cannot honour.
     Sending a filter that is ignored is worse than not sending it: the user
     believes results are narrowed when they are not. */
  function syncCapabilities() {
    const caps = Search.capabilities();
    const mirror = Search.getActiveMirror();

    // Map each filter control to the capability that governs it. Only real
    // elements belong here — els.tabs is an Array and has no classList.
    const groups = [
      {
        cap: 'content',
        nodes: [
          $('f-content').closest('.field-group'),
          $('presets').closest('.field-group'),
          els.welcome ? els.welcome.querySelector('.welcome-cats') : null
        ]
      },
      { cap: 'lang', nodes: [$('f-lang').closest('.field-group')] },
      { cap: 'sort', nodes: [$('f-sort').closest('.field-group'), els.sortSelect.closest('.sort-wrap')] },
      { cap: 'ext', nodes: [els.extChips, $('f-ext').closest('.field-group'), els.typeSelect.closest('.sort-wrap')] },
      { cap: 'year', nodes: [$('f-year-from').closest('.field-row')] }
    ];

    const missing = [];
    for (const g of groups) {
      const ok = !!caps[g.cap];
      if (!ok) missing.push(g.cap);
      for (const node of g.nodes) {
        if (!node) continue;
        node.classList.toggle('unsupported', !ok);
        // Disable interactive descendants only.
        Array.from(node.querySelectorAll('input, select, button')).forEach((el) => {
          el.disabled = !ok;
        });
      }
    }

    // The category pill nav is a sibling of the sheet, not inside a field group.
    const nav = document.querySelector('.cat-nav');
    if (nav) nav.classList.toggle('unsupported', !caps.content);
    els.tabs.forEach((t) => { t.disabled = !caps.content; });

    // Grey out file formats this mirror does not offer.
    if (caps.formats) {
      const allowed = new Set(caps.formats);
      Array.from(els.extChips.querySelectorAll('.chip')).forEach((chip) => {
        chip.disabled = !allowed.has(chip.dataset.ext);
      });
      Array.from(els.typeSelect.options).forEach((opt) => {
        opt.disabled = !!opt.value && !allowed.has(opt.value);
      });
    }

    // Sort options: a mirror with no sort support cannot offer any of them.
    if (!caps.sort) {
      [$('f-sort'), els.sortSelect].forEach((sel) => {
        Array.from(sel.options).forEach((o) => { o.disabled = !!o.value; });
      });
    }

    renderMirrorNote(missing, mirror);
  }

  const FILTER_LABELS = {
    content: 'category', lang: 'language', sort: 'sort order',
    ext: 'file format', year: 'year range'
  };

  function renderMirrorNote(missing, mirror) {
    const el = $('mirror-note');
    if (!el) return;
    if (!missing.length) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    const names = missing.map((m) => FILTER_LABELS[m] || m);
    el.hidden = false;
    el.innerHTML = '';
    const ic = document.createElement('span');
    ic.className = 'mn-ic';
    ic.textContent = 'ⓘ';
    const txt = document.createElement('div');
    const strong = document.createElement('b');
    strong.textContent = mirror.label + ' — ';
    txt.appendChild(strong);
    txt.appendChild(document.createTextNode(
      'this mirror does not support ' + names.join(', ') +
      '. Those controls are disabled rather than silently ignored, so results are unfiltered by them.'
    ));
    el.appendChild(ic);
    el.appendChild(txt);
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
        if (b === r.ext.toUpperCase()) {
          span.className = 'badge ext ext-' + r.ext.toLowerCase();
        } else {
          span.className = 'badge';
        }
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
    div.dataset.letter = (title || '?').trim().charAt(0) || '?';
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
      const res = await Search.search({
        query,
        category: state.category,
        lang: filters.lang,
        ext: filters.ext,
        sort: filters.sort,
        yearFrom: filters.yearFrom,
        yearTo: filters.yearTo,
        page: state.page
      });
      const results = res.results;

      // The active mirror may have changed during failover.
      syncCapabilities();

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
      // Report the real, classified reason. The old message hardcoded
      // "the Worker is not deployed yet", which sent users to redeploy a
      // Worker that was running fine.
      const detail = err && err.detail && err.detail.attempts ? err.detail.attempts : [];
      let msg = Search.explain(err);
      if (detail.length) {
        msg += '  (' + detail.map((a) => a.mirror + ': ' + a.reason).join(', ') + ')';
      }
      showStatus(msg, true);
    } finally {
      state.loading = false;
    }
  }

  function setCategory(cat) {
    // A category is meaningless on a mirror that ignores `content`. Leave the
    // selection alone rather than showing the user a filter that does nothing.
    if (!Search.capabilities().content) return;
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
    currentItem = r;
    currentItemHtml = '';
    els.downloads.hidden = false;
    els.downloadsTitle.textContent = r.title || 'Downloads';
    els.downloadsSub.textContent = [r.type, r.authors, r.ext && r.ext.toUpperCase(), r.size, r.year]
      .filter(Boolean).join('  ·  ');
    els.downloadsList.innerHTML = '';
    els.downloadsDesc.hidden = true;
    els.downloadsDesc.innerHTML = '';
    els.downloadsDesc.dataset.loaded = '';
    els.downloadsPage.href = r.href || '#';
    if (r.cover) {
      els.downloadsCover.src = r.cover;
      els.downloadsCover.hidden = false;
    } else {
      els.downloadsCover.hidden = true;
    }
    showDownloadsStatus('Loading download links…');

    try {
      const text = await Search.fetchProxied(r.href);
      currentItemHtml = text;
      const { links, loginRequired } = Parser.parseDownloads(text);

      if (!links.length && loginRequired) {
        renderLoginGate();
        showDownloadsStatus(
          'This mirror requires a signed-in Anna’s Archive account before it reveals download ' +
          'links. Use “Open on Anna’s” to view the record and sign in there.', true);
        return;
      }
      if (!links.length) {
        showDownloadsStatus('No download links found on this record.', true);
        return;
      }
      renderDownloadLinks(links);
      hideDownloadsStatus();
    } catch (err) {
      showDownloadsStatus('Could not load download links. ' + Search.explain(err), true);
    }
  }

  /* Mirrors that gate downloads behind an account render a sign-in prompt
     instead of a list. Say so explicitly rather than showing an empty box. */
  function renderLoginGate() {
    els.downloadsList.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'dl-login-gate';
    const h = document.createElement('b');
    h.textContent = 'Sign-in required';
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'This mirror only reveals download links to signed-in visitors. ' +
      'Open the record on Anna’s Archive to continue.';
    box.appendChild(h);
    box.appendChild(p);
    els.downloadsList.appendChild(box);
  }

  async function toggleDescription() {
    if (!currentItem) return;
    if (!currentItemHtml) {
      showDownloadsStatus('Loading record details…');
    }
    // Toggle off if already visible.
    if (!els.downloadsDesc.hidden) {
      els.downloadsDesc.hidden = true;
      return;
    }
    els.downloadsDesc.hidden = false;
    // If already loaded for this item, just reveal it.
    if (els.downloadsDesc.dataset.loaded === '1') return;

    els.downloadsDesc.innerHTML = '<em>Loading description…</em>';
    els.downloadsDesc.classList.add('loading');
    try {
      let html = currentItemHtml;
      if (!html) html = await Search.fetchProxied(currentItem.href);
      currentItemHtml = html;
      const desc = Parser.parseDescription(html);
      els.downloadsDesc.classList.remove('loading');
      els.downloadsDesc.dataset.loaded = '1';
      if (!desc) {
        els.downloadsDesc.innerHTML = '<em>No description available.</em>';
        return;
      }
      // desc is already sanitized HTML from the parser — render as-is.
      els.downloadsDesc.innerHTML = desc;
      hideDownloadsStatus();
    } catch (err) {
      els.downloadsDesc.classList.remove('loading');
      els.downloadsDesc.dataset.loaded = '1';
      els.downloadsDesc.innerHTML = '<em>Could not load the description.</em>';
      showDownloadsStatus(Search.explain(err), true);
    }
  }

  function renderDownloadLinks(links) {
    els.downloadsList.innerHTML = '';
    const free = links.filter((l) => l.kind === 'slow');
    if (!free.length) {
      els.downloadsList.innerHTML = '<p class="hint" style="padding:6px 4px">No free download servers are available for this item.</p>';
      return;
    }
    free.forEach((link, i) => {
      const a = document.createElement('a');
      a.className = 'dl-link free';
      a.href = link.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = 'Free server — opens Anna’s “Download now” page';

      const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ic.setAttribute('class', 'dl-ic');
      ic.setAttribute('viewBox', '0 0 24 24');
      ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = '<path d="M12 3v10.2l3.6-3.6 1.4 1.4L12 16 6.9 11 8.4 9.6 12 13.2V3Zm-7 14h14v2H5z"/>';

      const label = document.createElement('span');
      label.className = 'dl-label';
      label.textContent = 'Download Server #' + (i + 1);

      const tag = document.createElement('span');
      tag.className = 'dl-tag';
      tag.textContent = 'Free';

      a.appendChild(ic);
      a.appendChild(label);
      a.appendChild(tag);
      els.downloadsList.appendChild(a);
    });
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
        // No sort on the front page: the active mirror may not support it,
        // and "newest added" is not available everywhere.
        const res = await Search.search({ query: topic, category: 'top', page: 1 });
        results = res.results;
        syncCapabilities();
        if (results.length) localStorage.setItem(cacheKey, JSON.stringify(results));
      }
    } catch (err) {
      // A failed front page is not worth an error banner on first paint;
      // the welcome screen explains the state.
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
    // Buttons are now visible by default in HTML
    // Hide them initially if we know the app is already installed or not supported
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    if (isStandalone || isIOS) {
      // On iOS, PWA install works differently (Share menu -> Add to Home Screen)
      // In standalone mode, app is already installed
      els.installBtn.hidden = true;
      els.onboardInstall.hidden = true;
      return;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      // Enable install buttons now that prompt is available
      els.installBtn.disabled = false;
      els.onboardInstall.disabled = false;
      els.installBtn.title = 'Install app';
      els.onboardInstall.textContent = 'Install app';
      
      // Show install banner if not dismissed and not onboarded
      if (!localStorage.getItem(LS_INSTALL_DISMISSED) && !localStorage.getItem(LS_ONBOARDED)) {
        els.installBanner.hidden = false;
      }
    });

    // Initially disable buttons until beforeinstallprompt fires
    els.installBtn.disabled = true;
    els.onboardInstall.disabled = true;
    els.installBtn.title = 'Install app (checking availability…)';
    els.onboardInstall.textContent = 'Checking…';

    const promptInstall = async () => {
      if (!deferredPrompt) {
        // Prompt not ready yet - could be iOS or browser hasn't fired event
        if (isIOS) {
          showStatus('On iOS: tap Share → "Add to Home Screen" to install', false);
        } else {
          showStatus('Install not available yet. Try again in a moment.', false);
        }
        return;
      }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      // Hide all install UI after successful install
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
      els.onboardInstall.hidden = true;
    });
  }

  /* ---------- Onboarding tutorial ---------- */
  const obState = { step: 0, total: 0 };
  function setupOnboarding() {
    const slides = Array.from(els.onboard.querySelectorAll('.ob-slide'));
    const dots = Array.from(els.onboard.querySelectorAll('.ob-dot'));
    obState.total = slides.length;

    function render() {
      slides.forEach((s, i) => {
        s.classList.toggle('active', i === obState.step);
        s.classList.toggle('leaving', false);
      });
      dots.forEach((d, i) => d.classList.toggle('active', i === obState.step));

      const first = obState.step === 0;
      const last = obState.step === obState.total - 1;
      els.onboardBack.hidden = first;
      els.onboardNext.hidden = last;
      els.onboardClose.hidden = !last;
      // Re-trigger icon pop animation on the active slide.
      const ic = slides[obState.step].querySelector('.ob-ic, .ob-logo, .ob-ring');
      if (ic) { ic.style.animation = 'none'; void ic.offsetWidth; ic.style.animation = ''; }
    }

    function goTo(i) {
      obState.step = Math.max(0, Math.min(obState.total - 1, i));
      render();
    }

    function finish() {
      localStorage.setItem(LS_ONBOARDED, '1');
      els.onboard.hidden = true;
    }

    els.onboardNext.addEventListener('click', () => goTo(obState.step + 1));
    els.onboardBack.addEventListener('click', () => goTo(obState.step - 1));
    els.onboardSkip.addEventListener('click', finish);
    els.onboardClose.addEventListener('click', finish);

    obState.goTo = goTo;
    return { finish };
  }

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

  els.typeSelect.addEventListener('change', () => {
    $('f-ext').value = els.typeSelect.value;
    if (state.query) doSearch(true);
  });

  els.downloadsDescBtn.addEventListener('click', toggleDescription);

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

  // Downloads modal close
  els.downloadsClose.addEventListener('click', closeDownloads);
  els.downloads.addEventListener('click', (e) => { if (e.target === els.downloads) closeDownloads(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.downloads.hidden) closeDownloads();
      else if (!els.advancedPanel.hidden) closeSheet();
      else if (!els.onboard.hidden) {
        localStorage.setItem(LS_ONBOARDED, '1');
        els.onboard.hidden = true;
      }
    }
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
  setupOnboarding();
  maybeOnboard();
  attemptDefaultBrowse();
  Viewer.init();
})();

/* viewer.js — in-app iframe viewer with graceful external fallback. */

const Viewer = (() => {
  let frame, fallback, fallbackLink, titleEl, currentUrl = '';
  let loadTimer = null;

  function init() {
    frame = document.getElementById('viewer-frame');
    fallback = document.getElementById('viewer-fallback');
    fallbackLink = document.getElementById('viewer-fallback-link');
    titleEl = document.getElementById('viewer-title');

    document.getElementById('viewer-close').addEventListener('click', close);
    document.getElementById('viewer-external').addEventListener('click', () => {
      if (currentUrl) window.open(currentUrl, '_blank', 'noopener');
    });
    fallbackLink.addEventListener('click', () => {
      if (currentUrl) window.open(currentUrl, '_blank', 'noopener');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  function open(url, title) {
    if (!frame) init();
    currentUrl = url;
    titleEl.textContent = title || 'Viewer';
    fallback.hidden = true;
    document.getElementById('viewer').hidden = false;

    // Load through the proxy so Anna's X-Frame-Options doesn't block framing.
    const proxied = (typeof Search !== 'undefined' && Search.proxiedUrl) ? Search.proxiedUrl(url) : url;
    frame.src = proxied;

    // Heuristic: if nothing renders within a few seconds, offer the browser.
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      let blank = false;
      try {
        blank = !frame.contentWindow || frame.contentWindow.location.href === 'about:blank';
      } catch (_) {
        // Cross-origin: can't read, but a SecurityError means something loaded.
      }
      if (blank) {
        fallback.hidden = false;
        fallbackLink.href = url;
      }
    }, 9000);
  }

  function close() {
    document.getElementById('viewer').hidden = true;
    frame.src = 'about:blank';
    clearTimeout(loadTimer);
  }

  return { init, open, close };
})();

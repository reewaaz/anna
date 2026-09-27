/* parser.js — extract result cards from Anna's Archive search HTML.
 *
 * Anna's Archive has served two very different result layouts:
 *
 *  A) "legacy"  — the classic Tailwind list on annas-archive.gl:
 *       <div class="flex pt-3 pb-3 border-b ...">      (result item)
 *         <a href="/md5/..."> <img .../> </a>          (cover)
 *         <div> <a href="/md5/..." class="...js-vim-focus">TITLE</a>
 *               <a href="/search?q=...">AUTHOR</a>
 *               <div class="text-gray-800 ...">English [en] • PDF • 6.4MB • 2016</div>
 *
 *  B) "catalog" — the current card grid served by the annas-archive.is
 *     frontend. Different container, absolute hrefs, different title class,
 *     and "·"-separated metadata:
 *       <div class="bg-white rounded-lg shadow p-4 mb-4">     (result item)
 *         <a href="https://annas-archive.is/books/674762-dune" class="custom-a shrink-0">
 *           <img src="https://…cover.jpg" alt="Dune">
 *         </a>
 *         <div class="min-w-0 flex-1">
 *           <h3 class="font-bold text-lg"><a href="…/books/…">Dune</a></h3>
 *           <div class="text-sm text-[#666]">Herbert, Frank · 1982 · EPUB · 1 B · Books catalog</div>
 *
 * Detection is structural (does a result <h3> contain a /books/ or /md5/ link?)
 * rather than based on Tailwind class names, so cosmetic restyling of either
 * frontend does not break the app.
 */

const Parser = (() => {
  // Origin used to resolve relative hrefs. Set from the active mirror by
  // search.js — previously this was hardcoded to annas-archive.gl, which
  // silently produced dead links whenever a different mirror was in use.
  let AA_ORIGIN = 'https://annas-archive.gl';

  // Kept in sync with Search's per-mirror `formats` list. The catalog frontend
  // reports several formats the legacy list never showed (LRF, LIT, WBK, HTM),
  // so a short list here silently dropped the format badge.
  const EXT_RE = /\b(pdf|epub|mobi|azw3|djvu|txt|cbz|cbr|fb2|html|htm|lrf|lit|wbk|rtf|doc|docx|zip|chm|epub2|djvu?)\b/i;
  const SIZE_RE = /(\d+(?:[.,]\d+)?\s?(?:B|KB|MB|GB|TB))\b/i;
  const YEAR_RE = /\b(1[0-9]{3}|20[0-9]{2})\b/;
  // Accepts the middle dot, bullet and pipe separators used across frontends.
  const SEP_RE = /\s*[·•|]\s*/;

  function setOrigin(origin) {
    if (typeof origin === 'string' && /^https:\/\//.test(origin)) {
      AA_ORIGIN = origin.replace(/\/+$/, '');
    }
  }
  function getOrigin() { return AA_ORIGIN; }

  function absUrl(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    return AA_ORIGIN + (href.startsWith('/') ? '' : '/') + href;
  }

  function clean(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function parseMeta(text) {
    const out = { ext: '', size: '', year: '', lang: '', type: '' };
    if (!text) return out;

    const lang = text.match(/\[([a-z]{2,3})\]/i);
    if (lang) out.lang = lang[1].toLowerCase();

    const size = text.match(SIZE_RE);
    if (size) out.size = size[1].toUpperCase().replace(/\s+/g, '').replace(',', '.');

    const year = text.match(YEAR_RE);
    if (year) out.year = year[1];

    const type = text.match(/Books catalog|Journal article|Magazine|Standards document|Book \(([^)]*)\)|Comic/);
    if (type) out.type = clean(type[0]);

    const ext = text.match(EXT_RE);
    if (ext) out.ext = ext[1].toLowerCase();

    return out;
  }

  /* ---------- layout A: legacy list ---------- */
  function parseLegacy(doc) {
    const items = Array.from(doc.querySelectorAll('div.pt-3.border-b'))
      .filter((el) => el.querySelector('a[href*="/md5/"]'));
    const out = [];

    for (const item of items) {
      const md5 = item.querySelector('a[href*="/md5/"]');
      const href = absUrl(md5.getAttribute('href'));

      const img = item.querySelector('img');
      const cover = img ? img.getAttribute('src') : '';

      const titleLink = item.querySelector('a.js-vim-focus') || md5;
      const title = clean(titleLink.textContent) || clean(img && img.getAttribute('alt')) || 'Untitled';

      const authorLinks = Array.from(item.querySelectorAll('a[href*="/search?q="]'));
      const author = authorLinks.length ? clean(authorLinks[0].textContent) : '';

      const metaEl = item.querySelector('div.text-gray-800') || item;
      const meta = parseMeta(clean(metaEl.textContent));

      if (!meta.ext) {
        const pathEl = item.querySelector('div.font-mono');
        if (pathEl) {
          const m = pathEl.textContent.match(/\.([a-z0-9]+)$/i);
          if (m) meta.ext = m[1].toLowerCase();
        }
      }

      out.push({ title, authors: author, cover, href, ...meta, layout: 'legacy' });
    }
    return out;
  }

  /* ---------- layout B: catalog cards ---------- */
  function parseCatalog(doc) {
    const out = [];
    const seen = new Set();

    // One result per <h3> that wraps a /books/ or /md5/ link. Walking up to
    // the nearest ancestor holding an <img> finds the card without depending
    // on its Tailwind classes.
    for (const h3 of Array.from(doc.querySelectorAll('h3'))) {
      const link = h3.querySelector('a[href]');
      if (!link) continue;
      const rawHref = link.getAttribute('href') || '';
      if (!/\/(books|md5)\//.test(rawHref)) continue;

      const href = absUrl(rawHref);
      if (seen.has(href)) continue;

      let card = h3;
      let guard = 0;
      while (card && card !== doc.body && guard++ < 8) {
        if (card.querySelector('img')) break;
        card = card.parentElement;
      }
      if (!card) card = h3;

      const title = clean(link.textContent) || 'Untitled';
      const img = card.querySelector('img');
      const cover = img ? absUrl(img.getAttribute('src')) : '';

      // Metadata lives in "·"-separated lines under the title, e.g.
      //   "Herbert, Frank · 1982 · EPUB · 1 B · Books catalog"
      //   "Publisher: Berkley"
      const metaLines = Array.from(card.querySelectorAll('div.text-sm'))
        .map((d) => clean(d.textContent))
        .filter((t) => t && t !== title);

      const joined = metaLines.join(' ');
      const meta = parseMeta(joined);

      // Catalog metadata is a "·"-separated list, e.g.
      //   "Herbert, Frank · 1982 · EPUB · 1 B · Books catalog"
      //   "Herbert, Brian; Herbert, Frank · Books catalog"   (no year)
      // Parse the first line segment-by-segment so a year is read from its own
      // field rather than scraped out of arbitrary text (a 4-digit number in a
      // title or ISBN must not be mistaken for a publication year).
      let author = '';
      if (metaLines.length) {
        const segments = metaLines[0].split(SEP_RE).map((s) => s.trim()).filter(Boolean);
        for (const seg of segments) {
          if (YEAR_RE.test(seg) && seg.length <= 5) {
            if (!meta.year) meta.year = seg.trim();
            continue;
          }
          if (EXT_RE.test(seg) && seg.length <= 6) { if (!meta.ext) meta.ext = seg.match(EXT_RE)[1].toLowerCase(); continue; }
          if (SIZE_RE.test(seg) && seg.length <= 9) { if (!meta.size) meta.size = seg.replace(/\s+/g, '').replace(',', '.').toUpperCase(); continue; }
          if (/catalog$/i.test(seg)) { if (!meta.type) meta.type = seg; continue; }
          if (!author) author = seg;
        }
        // "Unknown author" is a placeholder, not an author.
        if (/^unknown author$/i.test(author)) author = '';
      }

      seen.add(href);
      out.push({
        title,
        authors: author,
        cover,
        href,
        ext: meta.ext,
        size: meta.size,
        year: meta.year,
        lang: meta.lang,
        type: meta.type,
        layout: 'catalog'
      });
    }
    return out;
  }

  function parse(html) {
    if (!html) return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Prefer whichever layout is actually present; fall back to the other so a
    // frontend change on one mirror cannot take the whole app down.
    const catalog = parseCatalog(doc);
    if (catalog.length) return catalog;
    return parseLegacy(doc);
  }

  /* ---------- download links ---------- */
  /* Returns { links, loginRequired }. The catalog frontend gates every
     download behind an account, so the caller must be able to tell the
     difference between "no downloads" and "you need to log in". */
  function parseDownloads(html) {
    const out = { links: [], loginRequired: false };
    if (!html) return out;
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Catalog layout: anchors explicitly saying the visitor must log in.
    const gated = Array.from(doc.querySelectorAll('a[href*="/account"]'))
      .filter((a) => /log\s?in/i.test(clean(a.textContent)));
    if (gated.length) out.loginRequired = true;

    // Legacy layout: /md5/<hash> pages carrying js-download-link anchors.
    const anchors = Array.from(doc.querySelectorAll('a.js-download-link'));
    const seen = new Set();
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const label = clean(a.textContent) || 'Download';
      const full = absUrl(href);
      if (seen.has(full)) continue;
      seen.add(full);
      const kind = /\/slow_download\//.test(href) ? 'slow' : 'fast';
      out.links.push({ label, href: full, kind });
    }

    if (!out.links.length && out.loginRequired) {
      out.links = []; // explicit: gated, not merely empty
    }
    return out;
  }

  // Keep only a safe subset of formatting tags; strip scripts, styles,
  // iframes and any inline event handlers / javascript: URLs.
  const ALLOWED_TAGS = new Set([
    'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'SMALL', 'SPAN',
    'A', 'UL', 'OL', 'LI', 'DIV', 'H3', 'H4', 'H5', 'CODE', 'PRE', 'BLOCKQUOTE'
  ]);

  function sanitizeAttrs(el) {
    Array.from(el.attributes).forEach((attr) => {
      const n = attr.name.toLowerCase();
      const v = attr.value.trim().toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(attr.name);
      else if ((n === 'href' || n === 'src') && (v.startsWith('javascript:') || v.startsWith('data:'))) {
        el.removeAttribute(attr.name);
      }
    });
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }

  function sanitize(root) {
    const clone = root.cloneNode(true);
    const stack = [clone];
    while (stack.length) {
      const el = stack.pop();
      Array.from(el.childNodes).forEach((child) => {
        if (child.nodeType !== 1) return; // skip text/comment nodes
        if (!ALLOWED_TAGS.has(child.tagName)) {
          // Flatten: lift the element's children up, then drop it.
          while (child.firstChild) el.insertBefore(child.firstChild, child);
          el.removeChild(child);
          stack.push(el); // re-process since children changed
        } else {
          sanitizeAttrs(child);
          stack.push(child);
        }
      });
    }
    return clone.innerHTML.trim();
  }

  function parseDescription(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Catalog layout: a label/value definition box.
    const box = doc.querySelector('.js-book-top-box-description');
    if (box) {
      const pairs = [];
      let lastLabel = '';
      for (const node of Array.from(box.children)) {
        const text = clean(node.textContent);
        if (!text) continue;
        if (/text-gray-500/.test(node.className || '')) {
          lastLabel = text.replace(/:$/, '');
        } else if (lastLabel) {
          pairs.push(`<div><b>${lastLabel}:</b> ${escapeHtml(text)}</div>`);
        }
      }
      return pairs.join('');
    }

    // Legacy layout.
    const wrap = doc.querySelector('div.description') || doc.querySelector('[class*="description"]');
    if (!wrap) return '';
    const content = wrap.querySelector('.mb-1') || wrap.querySelector('div.text-gray-800') || wrap;
    const text = clean(content.textContent).replace(/^description/i, '').trim();
    if (!text) return '';
    return sanitize(content);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  return { parse, parseDownloads, parseDescription, setOrigin, getOrigin };
})();

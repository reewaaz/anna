/* parser.js — extract result cards from Anna's Archive search HTML.
   The live markup is Tailwind-based:
     <div class="flex pt-3 pb-3 border-b ...">          (result item)
       <a href="/md5/..."> <img .../> </a>              (cover)
       <div> <a href="/md5/..." class="...js-vim-focus">TITLE</a>
             <a href="/search?q=...">AUTHOR</a>
             <div class="text-gray-800 ...">English [en] • PDF • 6.4MB • 2016 • Book (non-fiction) • …</div>
       </div>
     </div>
*/

const Parser = (() => {
  const AA_ORIGIN = 'https://annas-archive.gl';
  const EXT_RE = /\b(pdf|epub|mobi|azw3|djvu|txt|cbz|cbr|fb2|html|rtf|docx?|zip)\b/i;

  function absUrl(href) {
    if (!href) return '';
    if (href.startsWith('http')) return href;
    return AA_ORIGIN + (href.startsWith('/') ? '' : '/') + href;
  }
  function clean(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function parseMeta(text) {
    const out = { ext: '', size: '', year: '', lang: '', type: '' };
    const lang = text.match(/\[([a-z]{2})\]/i);
    if (lang) out.lang = lang[1].toLowerCase();
    const size = text.match(/(\d+(?:\.\d+)?\s?(?:KB|MB|GB|TB))/i);
    if (size) out.size = size[1].toUpperCase().replace(/\s/, '');
    const year = text.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
    if (year) out.year = year[1];
    const type = text.match(/Book \(([^)]*)\)|Journal article|Magazine|Standards document|Comic/);
    if (type) out.type = clean(type[0]);
    const ext = text.match(EXT_RE);
    if (ext) out.ext = ext[1].toLowerCase();
    return out;
  }

  function parse(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = Array.from(doc.querySelectorAll('div.pt-3.border-b'))
      .filter((el) => el.querySelector('a[href^="/md5/"]'));
    const out = [];

    for (const item of items) {
      const md5 = item.querySelector('a[href^="/md5/"]');
      const href = absUrl(md5.getAttribute('href'));

      const img = item.querySelector('img');
      const cover = img ? img.getAttribute('src') : '';

      const titleLink = item.querySelector('a.js-vim-focus') || md5;
      const title = clean(titleLink.textContent) || clean(img?.getAttribute('alt')) || 'Untitled';

      const searchLinks = Array.from(item.querySelectorAll('a[href^="/search?q="]'));
      const author = searchLinks.length ? clean(searchLinks[0].textContent) : '';

      const metaEl = item.querySelector('div.text-gray-800') || item;
      const meta = parseMeta(clean(metaEl.textContent));

      if (!meta.ext) {
        const pathEl = item.querySelector('div.font-mono');
        if (pathEl) {
          const m = pathEl.textContent.match(/\.([a-z0-9]+)$/i);
          if (m) meta.ext = m[1].toLowerCase();
        }
      }

      out.push({
        title,
        authors: author,
        cover,
        href,
        ext: meta.ext,
        size: meta.size,
        year: meta.year,
        lang: meta.lang,
        type: meta.type
      });
    }
    return out;
  }

  function parseDownloads(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const anchors = Array.from(doc.querySelectorAll('a.js-download-link'));
    const out = [];
    const seen = new Set();
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const label = clean(a.textContent) || 'Download';
      const full = absUrl(href);
      if (seen.has(full)) continue;
      seen.add(full);
      out.push({ label, href: full });
    }
    return out;
  }

  return { parse, parseDownloads };
})();

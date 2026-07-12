/* parser.js — extract result cards from Anna's Archive search HTML. */

const Parser = (() => {
  const AA_ORIGIN = 'https://annas-archive.gl';
  const EXT_RE = /\.?(pdf|epub|mobi|azw3|djvu|txt|cbz|cbr|fb2|html|rtf|docx?|zip)/i;
  const SIZE_RE = /(\d+(?:\.\d+)?\s?(?:KB|MB|GB|TB))/i;
  const YEAR_RE = /\b(1[0-9]{3}|20[0-9]{2})\b/;

  function absUrl(href) {
    if (!href) return '';
    if (href.startsWith('http')) return href;
    return AA_ORIGIN + (href.startsWith('/') ? '' : '/') + href;
  }

  function clean(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function containerOf(link) {
    return (
      link.closest('.result') ||
      link.closest('li') ||
      link.closest('[class*="result"]') ||
      link.closest('.book') ||
      link.parentElement?.parentElement ||
      link.parentElement
    );
  }

  function extractAuthors(container, root) {
    // Try an element whose text mentions "Author".
    const candidates = container.querySelectorAll('div, span, p');
    for (const el of candidates) {
      const t = clean(el.textContent);
      if (/author/i.test(el.className || '') && t && !/^author$/i.test(t)) {
        return t.replace(/^authors?:/i, '').trim();
      }
    }
    return '';
  }

  function parse(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a[href*="/md5/"]'));
    const out = [];

    for (const link of links) {
      const href = absUrl(link.getAttribute('href'));
      if (!href) continue;

      const container = containerOf(link);
      const img = container?.querySelector('img');
      const cover = img ? absUrl(img.getAttribute('src')) : '';

      const h3 = container?.querySelector('h3');
      const title =
        clean(h3 ? h3.textContent : '') ||
        clean(link.textContent) ||
        clean(img?.getAttribute('alt')) ||
        'Untitled';

      const authors = extractAuthors(container, doc);

      const text = clean(container ? container.textContent : title);
      const extMatch = text.match(EXT_RE);
      const sizeMatch = text.match(SIZE_RE);
      const yearMatch = text.match(YEAR_RE);

      out.push({
        title,
        authors,
        cover,
        href,
        ext: extMatch ? extMatch[1].toLowerCase() : '',
        size: sizeMatch ? sizeMatch[1] : '',
        year: yearMatch ? yearMatch[1] : '',
        snippet: text.slice(0, 160)
      });
    }
    return out;
  }

  return { parse };
})();

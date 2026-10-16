import * as cheerio from 'cheerio';

const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };

export async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

const KEEP = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'p', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code', 'em', 'strong', 'b', 'i', 'sub', 'sup', 'blockquote', 'br', 'hr', 'figure', 'figcaption', 'span', 'div', 'dl', 'dt', 'dd']);
const ATTRS = new Set(['href', 'src', 'alt', 'id', 'colspan', 'rowspan', 'width', 'height']);

export interface Article { title: string; html: string; text: string; headings: { id: string; level: number; text: string }[]; links: { href: string; text: string }[] }

// Extract the readable main content of a page as clean HTML (headings get stable ids).
export async function fetchArticle(url: string): Promise<Article> {
  const raw = await fetchHtml(url);
  const $ = cheerio.load(raw);
  const title = ($('meta[property="og:title"]').attr('content') || $('title').text() || url).trim();
  $('script, style, noscript, nav, header, footer, aside, form, iframe, svg, button, input, select').remove();
  let root: cheerio.Cheerio<any> = $('main').first();
  for (const sel of ['article', '#content', '.content', '#main', 'body']) {
    if (root.length && root.text().trim().length > 400) break;
    root = $(sel).first();
  }
  const links: { href: string; text: string }[] = [];
  root.find('a[href]').each((_, el) => {
    try {
      const href = new URL($(el).attr('href')!, url).toString();
      links.push({ href, text: $(el).text().trim().replace(/\s+/g, ' ').slice(0, 120) });
    } catch {}
  });
  const headings: Article['headings'] = [];
  let hn = 0;
  root.find('*').each((_, el: any) => {
    const tag = el.tagName?.toLowerCase();
    if (!tag) return;
    if (!KEEP.has(tag)) { $(el).replaceWith($(el).contents()); return; }
    for (const a of Object.keys(el.attribs || {})) if (!ATTRS.has(a)) $(el).removeAttr(a);
    if (tag === 'a') {
      try { $(el).attr('href', new URL($(el).attr('href') || '', url).toString()).attr('target', '_blank').attr('rel', 'noopener'); } catch { $(el).removeAttr('href'); }
    }
    if (tag === 'img') {
      try { $(el).attr('src', new URL($(el).attr('src') || '', url).toString()); } catch { $(el).remove(); }
    }
    if (/^h[1-4]$/.test(tag)) {
      const id = `h-${++hn}`;
      $(el).attr('id', id);
      headings.push({ id, level: Number(tag[1]), text: $(el).text().trim().replace(/\s+/g, ' ') });
    }
  });
  const html = root.html() || '';
  const text = root.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  return { title, html, text, headings, links };
}

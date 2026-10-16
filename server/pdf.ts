import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { all, db, get, tx } from './db.ts';

export interface PageText { page: number; text: string; items: [string, number][] }

// Extract the text of every page with the vertical position (0..1 from the top) of each line.
export async function extractPages(file: string): Promise<PageText[]> {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await getDocument({ data, disableFontFace: true, isEvalSupported: false, verbosity: 0 } as any).promise;
  const out: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: [string, number][] = [];
    let text = '';
    let lastY: number | null = null;
    for (const it of tc.items as any[]) {
      if (!('str' in it)) continue;
      const [, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const yf = Math.max(0, Math.min(1, (y - (it.height || 10)) / vp.height));
      const yr = Math.round(yf * 1000) / 1000;
      const prev = items[items.length - 1];
      if (it.str.trim()) {
        if (prev && Math.abs(prev[1] - yr) < 0.004) prev[0] += ' ' + it.str;
        else items.push([it.str, yr]);
      }
      if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n';
      else if (text && !text.endsWith(' ') && it.str && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      lastY = y;
    }
    out.push({ page: p, text: text.replace(/[ \t]+/g, ' ').trim(), items });
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

export function storePages(materialId: string, pages: PageText[]) {
  const ins = db.prepare('INSERT OR REPLACE INTO pages (material_id, page, text, items) VALUES (?,?,?,?)');
  tx(() => { for (const p of pages) ins.run(materialId, p.page, p.text, JSON.stringify(p.items)); });
}

const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

// Find where an anchor phrase sits in a material. Searches the hinted page first, then neighbours, then everything.
export function locate(materialId: string, anchor: string | undefined, hintPage: number | undefined): { page: number; y: number } | null {
  const pages = all<{ page: number; items: string }>('SELECT page, items FROM pages WHERE material_id = ? ORDER BY page', materialId);
  if (!pages.length) return null;
  const order = [...pages].sort((a, b) => Math.abs(a.page - (hintPage || 1)) - Math.abs(b.page - (hintPage || 1)));
  const target = normalize(anchor || '');
  if (target.length >= 4) {
    for (const len of [48, 30, 18, 10]) {
      const needle = target.slice(0, len);
      if (needle.length < Math.min(len, target.length)) continue;
      for (const pg of order) {
        const items: [string, number][] = JSON.parse(pg.items || '[]');
        let s = '';
        const offs: number[] = [];
        for (const [str] of items) { offs.push(s.length); s += normalize(str); }
        const at = s.indexOf(needle);
        if (at >= 0) {
          let i = 0;
          while (i + 1 < offs.length && offs[i + 1] <= at) i++;
          return { page: pg.page, y: items[i]?.[1] ?? 0 };
        }
      }
      if (needle.length === target.length) break;
    }
  }
  if (hintPage) return { page: Math.min(Math.max(1, hintPage), pages.length), y: 0.06 };
  return null;
}

export function pageText(materialId: string, from: number, to: number): string {
  return all<{ page: number; text: string }>('SELECT page, text FROM pages WHERE material_id = ? AND page BETWEEN ? AND ? ORDER BY page', materialId, from, to)
    .map((p) => `[page ${p.page}]\n${p.text}`).join('\n\n');
}

export function pageCount(materialId: string): number {
  return get<{ n: number }>('SELECT COUNT(*) n FROM pages WHERE material_id = ?', materialId)?.n || 0;
}

export async function subPdf(file: string, from: number, to: number): Promise<Buffer> {
  const src = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const idx = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i).filter((i) => i < src.getPageCount());
  const copied = await out.copyPages(src, idx);
  copied.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}

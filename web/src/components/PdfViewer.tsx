import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { Spinner } from './ui';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface Marker { id: string; page: number; y: number; label: string; kind: 'section' | 'problem'; status?: string | null; side?: 'left' | 'right' }

interface Props {
  url: string;
  markers: Marker[];
  activeId?: string | null;
  focus?: { page: number; y?: number; key: number } | null;
  onMarkerClick?: (m: Marker) => void;
  renderHover?: (m: Marker) => React.ReactNode;
  onDwell?: (page: number) => void;
}

export function PdfViewer({ url, markers, activeId, focus, onMarkerClick, renderHover, onDwell }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [base, setBase] = useState<{ w: number; h: number }[]>([]);
  const [width, setWidth] = useState(760);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ page: number; y: number; key: number } | null>(null);
  const [hover, setHover] = useState<{ m: Marker; rect: DOMRect } | null>(null);
  const hoverTimer = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null); setBase([]); setErr(null);
    const task = pdfjs.getDocument({ url, isEvalSupported: false });
    task.promise.then(async (d) => {
      if (cancelled) return;
      const sizes: { w: number; h: number }[] = [];
      for (let i = 1; i <= d.numPages; i++) {
        const p = await d.getPage(i);
        const v = p.getViewport({ scale: 1 });
        sizes.push({ w: v.width, h: v.height });
      }
      if (cancelled) return;
      setBase(sizes);
      setDoc(d);
    }).catch((e) => !cancelled && setErr(e.message));
    return () => { cancelled = true; task.destroy(); };
  }, [url]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let last = -1;
    const measure = () => {
      const w = el.clientWidth;
      if (w === last || w === 0) return;
      last = w;
      setWidth(Math.max(240, Math.min(920, w - (w < 700 ? 64 : 140))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    // Backstop: layout can settle after mount (scrollbars, side panel) without a resize event reaching us.
    const t = setInterval(measure, 1000);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); clearInterval(t); };
  }, []);

  const scaleOf = (i: number) => (base[i] ? width / base[i].w : 1);

  // Scroll to a requested location and flash it.
  useEffect(() => {
    if (!focus || !doc || !scroller.current) return;
    const el = scroller.current.querySelector<HTMLElement>(`[data-page="${focus.page}"]`);
    if (!el) return;
    const h = base[focus.page - 1] ? base[focus.page - 1].h * scaleOf(focus.page - 1) : 1000;
    const top = el.offsetTop + (focus.y ?? 0) * h - 90;
    scroller.current.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    setFlash({ page: focus.page, y: focus.y ?? 0, key: focus.key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, doc]);

  // Spread out markers that would overlap on the same page.
  const placed = useMemo(() => {
    const byPage = new Map<number, Marker[]>();
    for (const m of markers) byPage.set(m.page, [...(byPage.get(m.page) || []), m]);
    const out = new Map<number, (Marker & { top: number })[]>();
    for (const [page, list] of byPage) {
      const h = base[page - 1] ? base[page - 1].h * scaleOf(page - 1) : 1000;
      const sides: Record<string, number> = { left: -100, right: -100 };
      const arr = [...list].sort((a, b) => a.y - b.y).map((m) => {
        const side = m.side || 'left';
        let top = Math.max(4, m.y * h);
        if (top < sides[side] + 28) top = sides[side] + 28;
        sides[side] = top;
        return { ...m, top };
      });
      out.set(page, arr);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, base, width]);

  const enter = (m: Marker, e: React.MouseEvent) => {
    clearTimeout(hoverTimer.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverTimer.current = setTimeout(() => setHover({ m, rect }), 120);
  };
  const leave = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(null), 260);
  };

  if (err) return <div className="viewer" ref={scroller}><div className="notice error" style={{ margin: 30 }}>Could not open this PDF: {err}</div></div>;

  return (
    <div className="viewer" ref={scroller}>
      {!doc && <div className="row center steel" style={{ padding: 60 }}><Spinner /> Opening document</div>}
      {doc && (
        <div className="pages">
          {base.map((b, i) => {
            const s = scaleOf(i);
            const page = i + 1;
            return (
              <div className="page-wrap" key={page} data-page={page}>
                <PdfPage doc={doc} page={page} scale={s} w={b.w * s} h={b.h * s} root={scroller} onDwell={onDwell} />
                {(placed.get(page) || []).map((m) => (
                  <button key={m.id} className={`marker ${m.kind}${m.side === 'right' ? ' right' : ''}${activeId === m.id ? ' on' : ''}`} style={{ top: m.top }}
                    onMouseEnter={(e) => enter(m, e)} onMouseLeave={leave} onClick={() => onMarkerClick?.(m)} title="">
                    {m.status && <span className={'dot ' + m.status} />}
                    <span className="n truncate">{m.label}</span>
                  </button>
                ))}
                {flash && flash.page === page && (
                  <div key={flash.key} className="flash" style={{ top: flash.y * b.h * s - 12, left: 64, right: 64 }} />
                )}
              </div>
            );
          })}
        </div>
      )}
      {hover && renderHover && (
        <HoverCard rect={hover.rect} onEnter={() => clearTimeout(hoverTimer.current)} onLeave={leave}>
          {renderHover(hover.m)}
        </HoverCard>
      )}
    </div>
  );
}

export function HoverCard({ rect, children, onEnter, onLeave }: { rect: DOMRect; children: React.ReactNode; onEnter: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: rect.right + 10, top: rect.top - 10 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    let left = rect.right + 10;
    if (left + 350 > window.innerWidth) left = Math.max(8, rect.left - 350);
    let top = rect.top - 12;
    if (top + h > window.innerHeight - 10) top = Math.max(10, window.innerHeight - h - 10);
    setPos({ left, top });
  }, [rect]);
  return (
    <div ref={ref} className="hovercard" style={pos} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
    </div>
  );
}

function PdfPage({ doc, page, scale, w, h, root, onDwell }: { doc: pdfjs.PDFDocumentProxy; page: number; scale: number; w: number; h: number; root: React.RefObject<HTMLDivElement | null>; onDwell?: (p: number) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { root: root.current, rootMargin: '900px 0px' });
    io.observe(el);
    let t: any = null;
    const dwell = new IntersectionObserver(([e]) => {
      clearTimeout(t);
      if (e.isIntersecting && e.intersectionRatio >= 0.45 && onDwell && (root.current?.clientHeight || 0) > 240) t = setTimeout(() => onDwell(page), 4000);
    }, { root: root.current, threshold: 0.45 });
    dwell.observe(el);
    return () => { io.disconnect(); dwell.disconnect(); clearTimeout(t); };
  }, [page, root, onDwell]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let renderTask: any = null;
    let textLayer: any = null;
    (async () => {
      const p = await doc.getPage(page);
      if (cancelled) return;
      const vp = p.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      // Render into a fresh canvas and swap it in when done, so a re-render (e.g. on resize)
      // never fights a still-cancelling render for the same canvas.
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      c.style.width = `${vp.width}px`;
      c.style.height = `${vp.height}px`;
      const ctx = c.getContext('2d')!;
      renderTask = p.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined } as any);
      const ok = await renderTask.promise.then(() => true, () => false);
      if (cancelled || !ok || !text.current || !canvas.current) return;
      canvas.current.replaceChildren(c);
      text.current.innerHTML = '';
      text.current.style.setProperty('--scale-factor', String(scale));
      text.current.style.setProperty('--total-scale-factor', String(scale));
      textLayer = new (pdfjs as any).TextLayer({ textContentSource: p.streamTextContent(), container: text.current, viewport: vp });
      await textLayer.render().catch(() => {});
    })();
    return () => { cancelled = true; renderTask?.cancel?.(); textLayer?.cancel?.(); };
  }, [near, doc, page, scale]);

  return (
    <div ref={holder} className="pdf-page" style={{ width: w, height: h }}>
      <div ref={canvas} className="canvas-host" />
      <div ref={text} className="textLayer" />
      <span className="page-num">{page}</span>
    </div>
  );
}

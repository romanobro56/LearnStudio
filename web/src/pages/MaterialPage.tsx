import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import renderMathInElement from 'katex/contrib/auto-render';
import { api, fmtTime, materialLink, type Material, type Problem, type Section } from '../api';
import { PdfViewer, HoverCard, type Marker } from '../components/PdfViewer';
import { MaterialOverview, ProblemPanel, SectionPanel } from '../components/Panels';
import { Icon, kindIcon, Markdown, Spinner, StatusDot } from '../components/ui';

// Marker text: "P3" for "Problem 3", or the document's own short label such as "1A-1".
const shortLabel = (p: Problem, i: number) => {
  const rest = p.label.replace(/^(problem|question|exercise|concept question|board question|extra problem)\s*/i, '').trim();
  if (/^\d+[a-z]?$/i.test(rest)) return `P${rest}`;
  if (rest && rest.length <= 6) return rest;
  const m = p.label.match(/(\d+[a-z]?)/i);
  return `P${m ? m[1] : i + 1}`;
};

export function MaterialPage() {
  const { id } = useParams();
  const [q, setQ] = useSearchParams();
  const nav = useNavigate();
  const [m, setM] = useState<Material | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ page: number; y?: number; key: number; t?: number } | null>(null);
  const [outline, setOutline] = useState(true);
  const [panel, setPanel] = useState(true);
  const readSent = useRef(new Set<string>());

  const load = useCallback(() => api<Material>(`/materials/${id}`).then(setM).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { setM(null); readSent.current = new Set(); load(); }, [load]);
  useEffect(() => {
    if (!m || m.status === 'ready' || m.status === 'error') return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [m?.status, load]);

  const isSol = m?.kind === 'solution';
  const selProblem = m?.problems?.find((p) => p.id === q.get('problem')) || null;
  const selSection = m?.sections?.find((s) => s.id === q.get('section')) || null;

  // Focus whatever the URL points at.
  useEffect(() => {
    if (!m) return;
    if (selProblem) {
      const page = isSol ? selProblem.solutionPage : selProblem.page;
      const y = isSol ? selProblem.solutionY : selProblem.y;
      if (page) setFocus({ page, y: y ?? 0, key: Date.now() });
    } else if (selSection) {
      if (selSection.page) setFocus({ page: selSection.page, y: selSection.y ?? 0, key: Date.now() });
      if (m.type === 'youtube' && selSection.tStart != null) setFocus({ page: 0, t: selSection.tStart, key: Date.now() });
    } else if (q.get('page')) setFocus({ page: Number(q.get('page')), y: 0, key: Date.now() });
    if (selProblem || selSection) setPanel(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.id, q.get('problem'), q.get('section')]);

  const pick = (kind: 'section' | 'problem', itemId: string) => setQ(kind === 'problem' ? { problem: itemId } : { section: itemId });
  const clear = () => setQ({});

  const setProblemStatus = (pid: string, s: string | null) => setM((mm) => mm && { ...mm, problems: mm.problems?.map((p) => (p.id === pid ? { ...p, status: s } : p)) });
  const setSectionStatus = (sid: string, s: string | null) => setM((mm) => mm && { ...mm, sections: mm.sections?.map((x) => (x.id === sid ? { ...x, status: s } : x)) });

  const markers: Marker[] = useMemo(() => {
    if (!m) return [];
    if (m.kind === 'source') return (m.sections || []).filter((s) => s.page).map((s) => ({ id: s.id, page: s.page!, y: s.y ?? 0.05, label: `§${s.idx + 1}`, kind: 'section', status: s.status === 'read' ? 'read' : null }));
    return (m.problems || []).map((p, i) => ({ p, i, page: isSol ? p.solutionPage : p.page, y: isSol ? p.solutionY : p.y }))
      .filter((x) => x.page).map(({ p, i, page, y }) => ({ id: p.id, page: page!, y: y ?? 0.05, label: shortLabel(p, i), kind: 'problem', status: p.status }));
  }, [m, isSol]);

  // Reading a page for a few seconds marks the sections on it as read.
  const onDwell = useCallback((page: number) => {
    if (!m || m.kind !== 'source') return;
    // A section counts as read once its last page has been on screen for a few seconds.
    const ids = (m.sections || []).filter((s) => s.page && (s.endPage || s.page) === page && s.status !== 'read' && !readSent.current.has(s.id)).map((s) => s.id);
    if (!ids.length) return;
    ids.forEach((x) => readSent.current.add(x));
    api('/progress/sections', { body: { ids } }).catch(() => {});
    setM((mm) => mm && { ...mm, sections: mm.sections?.map((s) => (ids.includes(s.id) ? { ...s, status: 'read' } : s)) });
  }, [m]);

  const renderHover = (mk: Marker) => {
    if (!m) return null;
    if (mk.kind === 'section') {
      const s = m.sections!.find((x) => x.id === mk.id)!;
      return <SectionHover s={s} onOpen={() => pick('section', s.id)} go={(to) => nav(to)} />;
    }
    const p = m.problems!.find((x) => x.id === mk.id)!;
    return <ProblemHover p={p} onOpen={() => pick('problem', p.id)} go={(to) => nav(to)} />;
  };

  if (err) return <div className="page"><div className="notice error">{err}</div></div>;
  if (!m) return <div className="page row steel"><Spinner /> Loading</div>;

  const fileUrl = `/api/materials/${m.id}/file`;
  const items = m.kind === 'source' ? m.sections || [] : m.problems || [];
  const activeId = selProblem?.id || selSection?.id || null;

  return (
    <div className={'reader' + (outline ? '' : ' no-outline') + (panel ? '' : ' no-panel')}>
      <aside className="outline">
        <div className="row between" style={{ padding: '4px 8px 10px' }}>
          <Link to={`/c/${m.courseId}`} className="small steel row" style={{ gap: 4 }}><Icon name="left" size={14} /> {m.course.code || m.course.title}</Link>
        </div>
        <div className="tag" style={{ padding: '0 9px 6px' }}>{m.kind === 'source' ? 'Sections' : 'Problems'}</div>
        {items.map((it: any, i: number) => (
          <div key={it.id} className={'o-item' + (activeId === it.id ? ' on' : '')} onClick={() => pick(m.kind === 'source' ? 'section' : 'problem', it.id)}>
            <StatusDot status={it.status} />
            <div className="grow">
              <div>{it.label ? <b style={{ fontWeight: 500 }}>{it.label}</b> : <><span className="steel">{i + 1}.</span> {it.title}</>}{it.label && it.title ? <span className="steel">: {it.title}</span> : null}</div>
              <div className="tiny steel">{m.kind === 'source' ? `${it.problems.length} practice` : `${it.sections.length} to review`}{it.page ? `, p. ${isSol ? it.solutionPage || it.page : it.page}` : it.tStart != null ? `, ${fmtTime(it.tStart)}` : ''}</div>
            </div>
          </div>
        ))}
        {!items.length && <div className="small steel" style={{ padding: 9 }}>{m.status === 'ready' ? 'Nothing found in this material.' : 'Still reading this material.'}</div>}
      </aside>

      <section className="viewer-col">
        <div className="toolbar">
          <button className="btn subtle icon" title="Toggle outline" onClick={() => setOutline(!outline)}><Icon name="list" /></button>
          <span className="chip" style={{ background: m.kind === 'source' ? 'var(--mist)' : 'var(--accent-soft)', color: m.kind === 'source' ? 'var(--ink)' : 'var(--accent)' }}>
            <Icon name={kindIcon(m)} size={13} /> {m.kind === 'source' ? 'Source' : m.kind === 'apply' ? 'Apply' : 'Solutions'}
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <h2 className="truncate">{m.title}</h2>
          </div>
          {m.kind === 'apply' && m.solution && !m.solution.inline && <Link className="btn sm" to={materialLink(m.solution.id, selProblem ? { problem: selProblem.id } : undefined)}><Icon name="doc" size={14} /> Solutions</Link>}
          {isSol && m.parent && <Link className="btn sm" to={materialLink(m.parent.id, selProblem ? { problem: selProblem.id } : undefined)}><Icon name="pen" size={14} /> Problems</Link>}
          {m.url && <a className="btn subtle icon" href={m.url} target="_blank" rel="noopener" title="Open original"><Icon name="link" /></a>}
          <button className="btn subtle icon" title="Toggle panel" onClick={() => setPanel(!panel)}><Icon name="panel" /></button>
        </div>
        {m.type === 'pdf' && m.status !== 'pending' && (
          <PdfViewer url={fileUrl} markers={markers} activeId={activeId} focus={focus} renderHover={renderHover}
            onMarkerClick={(mk) => pick(mk.kind, mk.id)} onDwell={onDwell} />
        )}
        {m.type === 'pdf' && m.status === 'pending' && <div className="viewer row center steel"><Spinner /> Downloading</div>}
        {m.type === 'youtube' && <VideoViewer m={m} focusT={focus?.t} focusKey={focus?.key} activeId={activeId} onPick={(sid) => pick('section', sid)} renderHover={renderHover} />}
        {m.type === 'web' && <WebViewer m={m} markers={m.sections || []} problems={m.problems || []} focusId={activeId} focusKey={focus?.key} onPick={pick} renderHover={renderHover} />}
        {m.type === 'image' && <div className="viewer"><div className="pages"><img src={fileUrl} style={{ maxWidth: '90%', borderRadius: 6 }} alt={m.title} /></div></div>}
      </section>

      {panel && (selProblem ? <ProblemPanel key={selProblem.id} problem={selProblem} material={m} onStatus={setProblemStatus} onClose={clear} />
        : selSection ? <SectionPanel key={selSection.id} section={selSection} material={m} onStatus={setSectionStatus} onClose={clear} />
          : <MaterialOverview material={m} onPick={pick} onReload={load} />)}
      {!panel && <span className="panel-gap" />}
    </div>
  );
}

function SectionHover({ s, onOpen, go }: { s: Section; onOpen: () => void; go: (to: string) => void }) {
  return (
    <div>
      <div className="tag" style={{ marginBottom: 4 }}>Section {s.idx + 1}</div>
      <h4>{s.title}</h4>
      <Markdown text={s.summary} className="steel small" />
      <div className="tag" style={{ marginTop: 10 }}>Practice this ({s.problems.length})</div>
      <div className="hc-list">
        {s.problems.slice(0, 6).map((p) => (
          <button key={p.id} className="hc-link" onClick={() => go(materialLink(p.materialId, { problem: p.id }))}>
            <StatusDot status={p.status} />
            <span className="grow"><b style={{ fontWeight: 500 }}>{p.material}</b> {p.label}{p.title ? `: ${p.title}` : ''}{p.reason && <span className="why">{p.reason}</span>}</span>
          </button>
        ))}
        {s.problems.length === 0 && <div className="small steel">No linked problems yet.</div>}
        {s.problems.length > 6 && <button className="btn link sm" onClick={onOpen}>See all {s.problems.length}</button>}
      </div>
    </div>
  );
}

function ProblemHover({ p, onOpen, go }: { p: Problem; onOpen: () => void; go: (to: string) => void }) {
  return (
    <div>
      <div className="row between"><div className="tag">{p.label}</div><StatusDot status={p.status} /></div>
      <h4 style={{ marginTop: 4 }}>{p.title || p.label}</h4>
      <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>{p.topics.slice(0, 4).map((t) => <span key={t} className="chip">{t}</span>)}</div>
      <div className="tag" style={{ marginTop: 10 }}>Review the material</div>
      <div className="hc-list">
        {p.sections.slice(0, 5).map((s) => (
          <button key={s.id} className="hc-link" onClick={() => go(materialLink(s.materialId, { section: s.id }))}>
            <StatusDot status={s.status} />
            <span className="grow"><b style={{ fontWeight: 500 }}>{s.material}</b>: {s.title}{s.page ? `, p. ${s.page}` : ''}{s.reason && <span className="why">{s.reason}</span>}</span>
          </button>
        ))}
        {p.sections.length === 0 && <div className="small steel">No linked material yet.</div>}
      </div>
      <button className="btn primary sm" style={{ marginTop: 10, width: '100%' }} onClick={onOpen}>Open problem: hints, solution, your work</button>
    </div>
  );
}

function VideoViewer({ m, focusT, focusKey, activeId, onPick, renderHover }: { m: Material; focusT?: number; focusKey?: number; activeId: string | null; onPick: (id: string) => void; renderHover: (mk: Marker) => React.ReactNode }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const vid = (m.url || '').match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})/);
  const id = vid ? vid[1] || vid[2] : '';
  const [hover, setHover] = useState<{ mk: Marker; rect: DOMRect } | null>(null);
  const timer = useRef<any>(null);
  const seek = (t: number) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [t, true] }), '*');
  useEffect(() => { if (focusT != null) seek(focusT); }, [focusKey]);
  return (
    <div className="viewer">
      <div className="video-wrap">
        <div className="video-frame"><iframe ref={frame} src={`https://www.youtube.com/embed/${id}?enablejsapi=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen title={m.title} /></div>
        <div className="col" style={{ gap: 4, marginTop: 16 }}>
          <div className="tag">Chapters</div>
          {(m.sections || []).map((s) => (
            <div key={s.id} className={'chapter' + (activeId === s.id ? ' on' : '')}
              onClick={() => { onPick(s.id); if (s.tStart != null) seek(s.tStart); }}
              onMouseEnter={(e) => { clearTimeout(timer.current); const rect = e.currentTarget.getBoundingClientRect(); timer.current = setTimeout(() => setHover({ mk: { id: s.id, page: 0, y: 0, label: '', kind: 'section' }, rect }), 250); }}
              onMouseLeave={() => { clearTimeout(timer.current); timer.current = setTimeout(() => setHover(null), 250); }}>
              <span className="ts">{fmtTime(s.tStart)}</span>
              <div className="grow"><b style={{ fontWeight: 500 }}>{s.title}</b><div className="small steel">{s.problems.length} practice problems</div></div>
              <StatusDot status={s.status} />
            </div>
          ))}
        </div>
      </div>
      {hover && <HoverCard rect={hover.rect} onEnter={() => clearTimeout(timer.current)} onLeave={() => setHover(null)}>{renderHover(hover.mk)}</HoverCard>}
    </div>
  );
}

function WebViewer({ m, markers, problems, focusId, focusKey, onPick, renderHover }: { m: Material; markers: Section[]; problems: Problem[]; focusId: string | null; focusKey?: number; onPick: (k: 'section' | 'problem', id: string) => void; renderHover: (mk: Marker) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState('');
  const [pos, setPos] = useState<{ id: string; top: number; label: string; kind: 'section' | 'problem'; status?: string | null }[]>([]);
  const [hover, setHover] = useState<{ mk: Marker; rect: DOMRect } | null>(null);
  const timer = useRef<any>(null);
  useEffect(() => { fetch(`/api/materials/${m.id}/file`).then((r) => r.text()).then(setHtml); }, [m.id]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !html) return;
    try { renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false }); } catch {}
    const list = [
      ...markers.map((s) => ({ id: s.id, anchor: (s as any).anchor, label: `§${s.idx + 1}`, kind: 'section' as const, status: s.status })),
      ...problems.map((p, i) => ({ id: p.id, anchor: (p as any).anchor, label: `P${i + 1}`, kind: 'problem' as const, status: p.status })),
    ];
    const out = list.map((x, i) => {
      const target = x.anchor ? el.querySelector<HTMLElement>('#' + CSS.escape(x.anchor)) : null;
      return { ...x, top: target ? target.offsetTop : 20 + i * 30 };
    });
    setPos(out);
  }, [html, markers, problems]);
  useEffect(() => {
    if (!focusId || !ref.current) return;
    const p = pos.find((x) => x.id === focusId);
    if (p) ref.current.parentElement?.scrollTo({ top: p.top - 60, behavior: 'smooth' });
  }, [focusId, focusKey, pos]);
  return (
    <div className="viewer">
      <div className="webdoc">
        <div ref={ref} className="md doc" dangerouslySetInnerHTML={{ __html: html }} />
        {pos.map((p) => (
          <button key={p.id} className={`marker ${p.kind}${focusId === p.id ? ' on' : ''}`} style={{ top: p.top + 34, left: -4 }}
            onClick={() => onPick(p.kind, p.id)}
            onMouseEnter={(e) => { clearTimeout(timer.current); const rect = e.currentTarget.getBoundingClientRect(); timer.current = setTimeout(() => setHover({ mk: { id: p.id, page: 0, y: 0, label: p.label, kind: p.kind }, rect }), 120); }}
            onMouseLeave={() => { clearTimeout(timer.current); timer.current = setTimeout(() => setHover(null), 260); }}>
            {p.status && <span className={'dot ' + p.status} />}<span className="n">{p.label}</span>
          </button>
        ))}
      </div>
      {hover && <HoverCard rect={hover.rect} onEnter={() => clearTimeout(timer.current)} onLeave={() => setHover(null)}>{renderHover(hover.mk)}</HoverCard>}
    </div>
  );
}

export function SolutionsDocPage() {
  const { id } = useParams();
  const [m, setM] = useState<Material | null>(null);
  const [g, setG] = useState<any>(null);
  useEffect(() => {
    api<Material>(`/materials/${id}`).then(setM);
    const tick = () => api<any>(`/materials/${id}/generated`).then((x) => { setG(x); return x; });
    tick();
    const t = setInterval(async () => { const x = await tick(); if (x?.status !== 'running') clearInterval(t); }, 3000);
    return () => clearInterval(t);
  }, [id]);
  return (
    <div className="main">
      <div className="page" style={{ maxWidth: 860 }}>
        {m && <Link to={materialLink(m.id)} className="small steel row" style={{ gap: 4, marginBottom: 14 }}><Icon name="left" size={14} /> Back to {m.title}</Link>}
        {!g ? <div className="row steel"><Spinner /> Loading</div>
          : g.status === 'running' ? <div className="notice row"><Spinner /> Writing worked solutions for every problem. This takes a minute.</div>
            : g.status === 'error' ? <div className="notice error">{g.markdown}</div>
              : <div className="card" style={{ background: 'var(--bg)', padding: 0 }}><Markdown text={g.markdown} className="doc" /></div>}
      </div>
    </div>
  );
}

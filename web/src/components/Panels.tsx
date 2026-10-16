import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtTime, materialLink, type Material, type Problem, type Section, type Submission } from '../api';
import { Icon, Markdown, Sparkle, Spinner, StatusDot } from './ui';
import { SubmissionCard, UploadWork } from './Work';

const STATUSES: { v: string | null; label: string }[] = [
  { v: null, label: 'Not started' },
  { v: 'attempted', label: 'Attempted' },
  { v: 'solved', label: 'Solved' },
];

interface ProblemDetail {
  id: string; materialId: string; label: string; title?: string; statement: string; topics: string[]; points?: number; page?: number;
  status: string | null; hints: { idx: number; text: string }[]; maxHints: number;
  official: { text: string; page?: number; y?: number; materialId?: string; answer?: string } | null;
  generated: { markdown: string; created_at: number } | null;
  submissions: Submission[];
}

export function ProblemPanel({ problem, material, onStatus, onClose }: { problem: Problem; material: Material; onStatus: (id: string, s: string | null) => void; onClose: () => void }) {
  const nav = useNavigate();
  const [d, setD] = useState<ProblemDetail | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [solveBusy, setSolveBusy] = useState(false);
  const [showSol, setShowSol] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openHint, setOpenHint] = useState<number>(0);

  useEffect(() => {
    setD(null); setShowSol(false); setErr(null);
    api<ProblemDetail>(`/problems/${problem.id}`).then((x) => { setD(x); setOpenHint(x.hints.length); }).catch((e) => setErr(e.message));
  }, [problem.id]);

  if (!d) return <div className="panel">{err ? <div className="notice error">{err}</div> : <div className="row steel"><Spinner /> Loading problem</div>}</div>;

  const setStatus = async (s: string | null) => {
    setD({ ...d, status: s });
    onStatus(d.id, s);
    await api('/progress', { method: 'PUT', body: { itemType: 'problem', itemId: d.id, status: s } });
  };
  const hint = async () => {
    setHintBusy(true); setErr(null);
    try {
      const r = await api<{ hints: { idx: number; text: string }[] }>(`/problems/${d.id}/hint`, { method: 'POST' });
      setD({ ...d, hints: r.hints, status: d.status || 'attempted' });
      setOpenHint(r.hints.length);
      if (!d.status) onStatus(d.id, 'attempted');
    } catch (e: any) { setErr(e.message); } finally { setHintBusy(false); }
  };
  const solve = async () => {
    setSolveBusy(true); setErr(null);
    try {
      const r = await api<{ markdown: string; created_at: number }>(`/problems/${d.id}/solve`, { method: 'POST' });
      setD({ ...d, generated: r });
      setShowSol(true);
    } catch (e: any) { setErr(e.message); } finally { setSolveBusy(false); }
  };
  const isSolutionDoc = material.kind === 'solution';

  return (
    <div className="panel">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="tag">{material.shortTitle || material.title}</div>
          <h2 style={{ marginTop: 4 }}>{d.label}{d.title ? <span className="steel" style={{ fontWeight: 400 }}>: {d.title}</span> : null}</h2>
        </div>
        <button className="btn subtle icon" onClick={onClose} title="Close"><Icon name="x" /></button>
      </div>
      {isSolutionDoc && material.parent && (
        <div className="notice" style={{ marginTop: 10 }}>You are in the solutions. <Link to={materialLink(material.parent.id, { problem: d.id })}>Go to the problem in {material.parent.title}</Link></div>
      )}
      <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
        <div className="seg">
          {STATUSES.map((s) => (
            <button key={String(s.v)} className={d.status === s.v ? 'on' : ''} onClick={() => setStatus(s.v)}>
              <StatusDot status={s.v} />{s.label}
            </button>
          ))}
        </div>
        {d.points ? <span className="chip">{d.points} pts</span> : null}
      </div>

      <details className="sec" open={false}>
        <summary className="tag" style={{ cursor: 'pointer' }}>Problem statement</summary>
        <div className="block" style={{ background: 'var(--mist)', marginTop: 8 }}><Markdown text={d.statement} /></div>
      </details>

      <div className="sec">
        <div className="tag"><Icon name="book" size={13} /> Review the material</div>
        {problem.sections.length === 0 && <div className="small steel">No linked material yet.</div>}
        <div className="col" style={{ gap: 5 }}>
          {problem.sections.map((s) => (
            <button key={s.id} className="hc-link" onClick={() => nav(materialLink(s.materialId, { section: s.id }))}>
              <StatusDot status={s.status} />
              <span className="grow"><b style={{ fontWeight: 500 }}>{s.material}</b>: {s.title}{s.page ? <span className="steel">, p. {s.page}</span> : s.tStart != null ? <span className="steel">, {fmtTime(s.tStart)}</span> : null}
                {s.reason && <span className="why">{s.reason}</span>}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sec">
        <div className="tag"><Icon name="bulb" size={13} /> Hints</div>
        {d.hints.map((h) => (
          <details key={h.idx} className="hint" open={openHint === h.idx} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setOpenHint(h.idx)}>
            <summary><Sparkle size={13} /> Hint {h.idx}<Icon name="chev" size={14} className="chev" /></summary>
            <div className="body"><Markdown text={h.text} /></div>
          </details>
        ))}
        <div className="row" style={{ marginTop: d.hints.length ? 8 : 0, gap: 6 }}>
          {d.hints.length < d.maxHints ? (
            <button className="btn onmist" style={{ background: 'var(--mist)' }} disabled={hintBusy} onClick={hint}>
              {hintBusy ? <Spinner /> : <Sparkle />} {d.hints.length ? `Show hint ${d.hints.length + 1}` : 'Get a hint'}
            </button>
          ) : <span className="small steel">That is every hint. Try the solution next.</span>}
          {d.hints.length > 0 && <span className="tiny steel">{d.hints.length} of {d.maxHints}</span>}
        </div>
      </div>

      <div className="sec">
        <div className="tag"><Icon name="check" size={13} /> Solution</div>
        {d.official ? (
          <div className="col" style={{ gap: 8 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              {d.official.materialId && d.official.materialId !== material.id && (
                <Link className="btn sm" to={materialLink(d.official.materialId, { problem: d.id })}><Icon name="doc" size={14} /> Official solution{d.official.page ? `, p. ${d.official.page}` : ''}</Link>
              )}
              <button className="btn sm" onClick={() => setShowSol(!showSol)}><Icon name="eye" size={14} /> {showSol ? 'Hide' : 'Show'} worked solution</button>
            </div>
            <div className={'block' + (showSol ? '' : ' locked')} style={{ background: 'var(--mist)' }}><Markdown text={d.official.text} /></div>
          </div>
        ) : d.generated ? (
          <div className="col" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="chip blue"><Sparkle size={12} /> AI-written</span>
              <button className="btn sm" onClick={() => setShowSol(!showSol)}><Icon name="eye" size={14} /> {showSol ? 'Hide' : 'Show'}</button>
              <button className="btn subtle sm" disabled={solveBusy} onClick={async () => { setSolveBusy(true); try { const r = await api<any>(`/problems/${d.id}/solve`, { body: { force: true } }); setD({ ...d, generated: r }); } finally { setSolveBusy(false); } }}>{solveBusy ? <Spinner /> : <Icon name="refresh" size={13} />} Rewrite</button>
            </div>
            <div className={'block' + (showSol ? '' : ' locked')} style={{ background: 'var(--mist)' }}><Markdown text={d.generated.markdown} /></div>
          </div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            <div className="small steel">No official solution came with this material.</div>
            <button className="btn primary" disabled={solveBusy} onClick={solve}>{solveBusy ? <><Spinner /> Working it out from the course material</> : <><Sparkle /> Write a worked solution</>}</button>
          </div>
        )}
      </div>

      <div className="sec">
        <div className="tag"><Icon name="pen" size={13} /> Your work</div>
        <div className="col" style={{ gap: 10 }}>
          {d.submissions.map((s) => (
            <SubmissionCard key={s.id} s={s}
              onChange={(ns) => { setD({ ...d, submissions: d.submissions.map((x) => (x.id === ns.id ? ns : x)) }); const v = ns.grade?.problems?.find((p) => p.problemId === d.id)?.verdict; if (v) { const st = v === 'correct' ? 'solved' : 'attempted'; setD((dd) => dd && { ...dd, status: dd.status === 'solved' ? 'solved' : st }); onStatus(d.id, st); } }}
              onDelete={() => setD({ ...d, submissions: d.submissions.filter((x) => x.id !== s.id) })} />
          ))}
          <UploadWork materialId={isSolutionDoc && material.parent ? material.parent.id : material.id} problemId={d.id} compact={d.submissions.length > 0}
            onUploaded={(s) => { setD({ ...d, submissions: [s, ...d.submissions], status: d.status || 'attempted' }); if (!d.status) onStatus(d.id, 'attempted'); }} />
        </div>
      </div>
      {err && <div className="notice error" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  );
}

export function SectionPanel({ section, material, onStatus, onClose }: { section: Section; material: Material; onStatus: (id: string, s: string | null) => void; onClose: () => void }) {
  const nav = useNavigate();
  const toggle = async () => {
    const s = section.status === 'read' ? null : 'read';
    onStatus(section.id, s);
    await api('/progress', { method: 'PUT', body: { itemType: 'section', itemId: section.id, status: s } });
  };
  return (
    <div className="panel">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="tag">{material.shortTitle || material.title}{section.page ? `, page ${section.page}` : section.tStart != null ? `, ${fmtTime(section.tStart)}` : ''}</div>
          <h2 style={{ marginTop: 4 }}>{section.title}</h2>
        </div>
        <button className="btn subtle icon" onClick={onClose} title="Close"><Icon name="x" /></button>
      </div>
      <div style={{ marginTop: 10 }}><Markdown text={section.summary} className="steel" /></div>
      <div className="row wrap" style={{ gap: 5, marginTop: 10 }}>
        {section.concepts.map((c) => <span key={c} className="chip">{c}</span>)}
      </div>
      <div style={{ marginTop: 14 }}>
        <button className={'btn sm' + (section.status === 'read' ? '' : ' primary')} onClick={toggle}>
          <Icon name="check" size={14} /> {section.status === 'read' ? 'Read' : 'Mark as read'}
        </button>
      </div>
      <div className="sec">
        <div className="tag"><Icon name="pen" size={13} /> Practice this ({section.problems.length})</div>
        {section.problems.length === 0 && <div className="small steel">No practice problems are linked to this section yet.</div>}
        <div className="col" style={{ gap: 5 }}>
          {section.problems.map((p) => (
            <button key={p.id} className="hc-link" onClick={() => nav(materialLink(p.materialId, { problem: p.id }))}>
              <StatusDot status={p.status} />
              <span className="grow"><b style={{ fontWeight: 500 }}>{p.material}</b> {p.label}{p.title ? <span className="steel">: {p.title}</span> : null}
                {p.reason && <span className="why">{p.reason}</span>}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MaterialOverview({ material, onPick, onReload }: { material: Material; onPick: (kind: 'section' | 'problem', id: string) => void; onReload: () => void }) {
  const [gen, setGen] = useState<{ status: string; markdown?: string } | null>(material.generated || null);
  const [subs, setSubs] = useState<Submission[]>(material.submissions?.filter((s) => !s.problemId) || []);
  const nav = useNavigate();
  useEffect(() => { setSubs(material.submissions?.filter((s) => !s.problemId) || []); setGen(material.generated || null); }, [material.id]);
  useEffect(() => {
    if (gen?.status !== 'running') return;
    const t = setInterval(async () => {
      const g = await api<any>(`/materials/${material.id}/generated`);
      if (g && g.status !== 'running') { setGen(g); clearInterval(t); }
    }, 2500);
    return () => clearInterval(t);
  }, [gen?.status, material.id]);

  const isApply = material.kind === 'apply';
  const items = isApply || material.kind === 'solution' ? material.problems || [] : material.sections || [];
  const done = isApply ? (material.problems || []).filter((p) => p.status === 'solved').length : (material.sections || []).filter((s) => s.status === 'read').length;

  return (
    <div className="panel">
      <div className="tag">{material.category || (isApply ? 'Practice' : 'Material')}{material.pageCount ? `, ${material.pageCount} pages` : ''}</div>
      <h2 style={{ marginTop: 4 }}>{material.title}</h2>
      {material.summary && <div style={{ marginTop: 10 }}><Markdown text={material.summary} className="steel" /></div>}
      {material.status !== 'ready' && (
        <div className={'notice ' + (material.status === 'error' ? 'error' : '')} style={{ marginTop: 12 }}>
          {material.status === 'error' ? <>Could not read this material: {material.statusMsg}</> : <span className="row"><Spinner /> Reading and linking this material</span>}
          {material.status === 'error' && <div style={{ marginTop: 6 }}><button className="btn sm" onClick={async () => { await api(`/materials/${material.id}/reprocess`, { method: 'POST' }); onReload(); }}>Try again</button></div>}
        </div>
      )}
      {material.meta?.keyConcepts?.length > 0 && (
        <div className="row wrap" style={{ gap: 5, marginTop: 12 }}>{material.meta.keyConcepts.slice(0, 10).map((c: string) => <span key={c} className="chip">{c}</span>)}</div>
      )}

      {isApply && (
        <div className="sec">
          <div className="tag"><Icon name="check" size={13} /> Solutions</div>
          {material.solution ? (
            material.solution.inline ? <div className="small steel">Solutions are included in this document; open any problem to see its worked solution.</div>
              : <Link className="btn" to={materialLink(material.solution.id)}><Icon name="doc" size={15} /> Open the official solutions</Link>
          ) : gen?.status === 'ready' ? (
            <div className="row" style={{ gap: 6 }}>
              <Link className="btn" to={`/m/${material.id}/solutions`}><Sparkle /> Open the solved document</Link>
            </div>
          ) : gen?.status === 'running' ? (
            <div className="notice row"><Spinner /> Writing a solved document from the course material</div>
          ) : (
            <div className="col" style={{ gap: 6 }}>
              <div className="small steel">This assignment came without solutions.</div>
              <button className="btn primary" onClick={async () => { await api(`/materials/${material.id}/solve`, { method: 'POST' }); setGen({ status: 'running' }); }}><Sparkle /> Generate a solved document</button>
            </div>
          )}
        </div>
      )}

      <div className="sec">
        <div className="tag"><Icon name="list" size={13} /> {isApply || material.kind === 'solution' ? 'Problems' : 'Sections'} <span className="steel" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{done} of {items.length} {isApply ? 'solved' : 'read'}</span></div>
        <div className="col" style={{ gap: 4 }}>
          {items.map((it: any) => (
            <button key={it.id} className="hc-link" onClick={() => onPick(isApply || material.kind === 'solution' ? 'problem' : 'section', it.id)}>
              <StatusDot status={it.status} />
              <span className="grow">{it.label ? <><b style={{ fontWeight: 500 }}>{it.label}</b>{it.title ? <span className="steel">: {it.title}</span> : null}</> : it.title}
                <span className="why">{isApply ? `${it.sections?.length || 0} linked sections` : `${it.problems?.length || 0} linked problems`}{it.page ? `, p. ${it.page}` : it.tStart != null ? `, ${fmtTime(it.tStart)}` : ''}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {isApply && (
        <div className="sec">
          <div className="tag"><Icon name="pen" size={13} /> Your work on the whole assignment</div>
          <div className="col" style={{ gap: 10 }}>
            {subs.map((s) => <SubmissionCard key={s.id} s={s} onChange={(ns) => { setSubs(subs.map((x) => (x.id === ns.id ? ns : x))); onReload(); }} onDelete={() => setSubs(subs.filter((x) => x.id !== s.id))} />)}
            <UploadWork materialId={material.id} onUploaded={(s) => setSubs([s, ...subs])} compact={subs.length > 0} />
          </div>
        </div>
      )}
      {material.url && <div className="sec small"><a href={material.url} target="_blank" rel="noopener">Original source</a> <button className="btn link sm" onClick={async () => { if (confirm('Remove this material from the course?')) { await api(`/materials/${material.id}`, { method: 'DELETE' }); nav(`/c/${material.courseId}`); } }}>Remove</button></div>}
    </div>
  );
}

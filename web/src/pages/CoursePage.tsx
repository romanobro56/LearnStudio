import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, materialLink } from '../api';
import { Bars, Icon, kindIcon, Markdown, Meter, Modal, Sparkle, Spinner } from '../components/ui';
import { JobLog } from './JobPage';
import { MapView } from './MapView';

export function CoursePage() {
  const { id } = useParams();
  const [c, setC] = useState<any>(null);
  const [tab, setTab] = useState<'path' | 'library' | 'map'>('path');
  const [adding, setAdding] = useState(false);
  const [practice, setPractice] = useState(false);
  const load = () => api(`/courses/${id}`).then(setC);
  useEffect(() => { setC(null); load(); }, [id]);
  const busy = c && (c.status !== 'ready' || c.stats.processing > 0 || c.jobs?.some((j: any) => j.status === 'running'));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [busy, id]);

  if (!c) return <div className="page row steel"><Spinner /> Loading course</div>;
  const s = c.stats;
  const runningJob = c.jobs?.find((j: any) => j.status === 'running');

  return (
    <div className="page">
      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        {c.code && <span className="chip blue">{c.code}</span>}
        <span className="chip">{c.provider}</span>
        {c.source_url && <a className="small" href={c.source_url} target="_blank" rel="noopener">Course site</a>}
      </div>
      <h1>{c.title}</h1>
      {c.description && <p className="steel" style={{ maxWidth: 760, marginTop: 10, fontSize: 15 }}>{c.description}</p>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', marginTop: 22 }}>
        <div className="card stat"><span className="tag">Material read</span><b className="mono">{s.read}<span className="steel" style={{ fontSize: 14, fontWeight: 400 }}> / {s.sections} sections</span></b><Bars value={s.read} total={s.sections} n={8} /></div>
        <div className="card stat"><span className="tag">Problems solved</span><b className="mono">{s.solved}<span className="steel" style={{ fontSize: 14, fontWeight: 400 }}> / {s.problems}</span></b><Bars value={s.solved} total={s.problems} n={8} green /></div>
        <div className="card stat"><span className="tag">Average grade</span><b className="mono">{s.avgGrade != null ? `${s.avgGrade}%` : 'None yet'}</b><span className="small steel">{s.graded} graded upload{s.graded === 1 ? '' : 's'}</span></div>
        <div className="card stat"><span className="tag">Connections</span><b className="mono">{s.links}</b><span className="small steel">links between Source and Apply</span></div>
      </div>

      {(runningJob || c.status !== 'ready') && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row" style={{ marginBottom: 8 }}><Spinner /><b style={{ fontWeight: 500 }}>{c.status === 'linking' ? 'Linking practice problems to the material' : c.status !== 'ready' ? 'Setting up this course' : runningJob?.title}</b><span className="steel small">{runningJob?.total ? `${runningJob.done} of ${runningJob.total} steps` : ''}</span></div>
          {runningJob && <Meter value={runningJob.done} total={runningJob.total || 1} />}
          {runningJob && <JobLog id={runningJob.id} lines={4} />}
        </div>
      )}

      <div className="row wrap" style={{ marginTop: 18, gap: 8 }}>
        {c.resume && <Link className="btn primary" to={materialLink(c.resume.materialId)}>Continue: {c.resume.title}</Link>}
        {!c.resume && c.materials[0] && <Link className="btn primary" to={materialLink(c.materials.find((m: any) => m.kind === 'source')?.id || c.materials[0].id)}>Start the course</Link>}
        <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add material</button>
        <button className="btn" onClick={() => setPractice(true)}><Sparkle /> Find more practice</button>
      </div>

      {c.overview?.outcomes?.length > 0 && (
        <details style={{ marginTop: 18 }}>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 500 }}>What you will learn</summary>
          <div className="grid c2" style={{ marginTop: 10 }}>
            <div className="card"><div className="tag" style={{ marginBottom: 6 }}>Outcomes</div><ul className="md" style={{ margin: 0, paddingLeft: 18 }}>{c.overview.outcomes.map((o: string) => <li key={o}><Markdown text={o} /></li>)}</ul></div>
            {c.overview.prerequisites?.length > 0 && <div className="card"><div className="tag" style={{ marginBottom: 6 }}>Prerequisites</div><ul className="md" style={{ margin: 0, paddingLeft: 18 }}>{c.overview.prerequisites.map((o: string) => <li key={o}><Markdown text={o} /></li>)}</ul></div>}
          </div>
        </details>
      )}

      <div className="tabs">
        <button className={'tab' + (tab === 'path' ? ' on' : '')} onClick={() => setTab('path')}>Learning path</button>
        <button className={'tab' + (tab === 'library' ? ' on' : '')} onClick={() => setTab('library')}>Library</button>
        <button className={'tab' + (tab === 'map' ? ' on' : '')} onClick={() => setTab('map')}>Knowledge web</button>
      </div>
      {tab === 'path' && <Path c={c} />}
      {tab === 'library' && <Library c={c} />}
      {tab === 'map' && <MapView courseId={c.id} units={c.units} />}

      {adding && <AddMaterial course={c} onClose={() => setAdding(false)} onStarted={() => { setAdding(false); load(); }} />}
      {practice && <FindPractice course={c} onClose={() => setPractice(false)} onStarted={() => { setPractice(false); load(); }} />}
    </div>
  );
}

function MatRow({ m }: { m: any }) {
  const done = m.kind === 'apply' ? m.solved : m.read;
  const total = m.kind === 'apply' ? m.problems : m.sections;
  return (
    <Link to={materialLink(m.id)} className={'mat ' + m.kind} title={m.title}>
      <span className="ico"><Icon name={kindIcon(m)} size={14} /></span>
      <span className="grow truncate">{m.title}</span>
      {m.status === 'ready' ? (total > 0 ? <Bars value={done} total={total} n={4} green={m.kind === 'apply'} /> : null)
        : m.status === 'error' ? <span className="dot error" title={m.statusMsg} /> : <span className="dot processing pulse" title="Processing" />}
    </Link>
  );
}

function Path({ c }: { c: any }) {
  const byUnit = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const m of c.materials) {
      if (m.kind === 'solution') continue;
      const u = m.unit ?? 0;
      map.set(u, [...(map.get(u) || []), m]);
    }
    return map;
  }, [c.materials]);
  const units = c.units.length ? c.units : [...byUnit.keys()].sort((a, b) => a - b).map((idx) => ({ idx, title: idx ? `Unit ${idx}` : 'Materials' }));
  const unassigned = byUnit.get(0) || byUnit.get(null as any) || [];
  let lastGrp: string | null = null;
  return (
    <div>
      {units.map((u: any) => {
        const mats = byUnit.get(u.idx) || [];
        const src = mats.filter((m) => m.kind === 'source');
        const app = mats.filter((m) => m.kind === 'apply');
        const total = mats.reduce((a, m) => a + (m.kind === 'apply' ? m.problems : m.sections), 0);
        const done = mats.reduce((a, m) => a + (m.kind === 'apply' ? m.solved : m.read), 0);
        const showGrp = u.grp && u.grp !== lastGrp;
        lastGrp = u.grp || lastGrp;
        if (!mats.length) return null;
        return (
          <React.Fragment key={u.idx}>
            {showGrp && <div className="grp-title">{u.grp}</div>}
            <div className="unit">
              <div className={'unit-num' + (total && done === total ? ' done' : '')}>{u.idx}</div>
              <div style={{ minWidth: 0 }}>
                <div className="row between">
                  <h3>{u.title}</h3>
                  {total > 0 && <span className="tiny steel mono">{done}/{total}</span>}
                </div>
                {u.summary && <div className="small steel" style={{ marginTop: 2 }}>{u.summary}</div>}
                <div className="unit-cols">
                  <div className="col" style={{ gap: 6 }}>
                    <div className="col-head"><Icon name="book" size={12} /> Source</div>
                    {src.map((m) => <MatRow key={m.id} m={m} />)}
                    {!src.length && <span className="tiny steel">Nothing to read in this unit</span>}
                  </div>
                  <div className="col" style={{ gap: 6 }}>
                    <div className="col-head"><Icon name="pen" size={12} /> Apply</div>
                    {app.map((m) => <MatRow key={m.id} m={m} />)}
                    {!app.length && <span className="tiny steel">No practice in this unit</span>}
                  </div>
                </div>
              </div>
            </div>
          </React.Fragment>
        );
      })}
      {c.units.length > 0 && unassigned.length > 0 && (
        <div className="unit"><div className="unit-num">+</div><div><h3>Other material</h3><div className="unit-cols">
          <div className="col" style={{ gap: 6 }}>{unassigned.filter((m: any) => m.kind === 'source').map((m: any) => <MatRow key={m.id} m={m} />)}</div>
          <div className="col" style={{ gap: 6 }}>{unassigned.filter((m: any) => m.kind === 'apply').map((m: any) => <MatRow key={m.id} m={m} />)}</div>
        </div></div></div>
      )}
      {!c.materials.length && <div className="card steel">No material yet. Add a PDF, a link or a playlist to get started.</div>}
    </div>
  );
}

function Library({ c }: { c: any }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(() => api(`/courses/${c.id}/search?q=${encodeURIComponent(q)}`).then(setRes), 250);
    return () => clearTimeout(t);
  }, [q, c.id]);
  const cats = (kind: string) => {
    const map = new Map<string, any[]>();
    for (const m of c.materials.filter((x: any) => x.kind === kind)) map.set(m.category || 'other', [...(map.get(m.category || 'other') || []), m]);
    return [...map.entries()];
  };
  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 520 }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--steel)' }} />
          <input className="field" style={{ paddingLeft: 36 }} placeholder="Search concepts, sections and problems" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {res && (
        <div className="grid c2" style={{ marginBottom: 20 }}>
          <div className="card"><div className="tag" style={{ marginBottom: 8 }}>Sections</div><div className="col" style={{ gap: 4 }}>
            {res.sections.map((s: any) => <Link key={s.id} className="hc-link" style={{ background: 'var(--block)' }} to={materialLink(s.material_id, { section: s.id })}><span className="grow"><b style={{ fontWeight: 500 }}>{s.short_title || s.mtitle}</b>: {s.title}<span className="why">{s.summary?.slice(0, 120)}</span></span></Link>)}
            {!res.sections.length && <span className="small steel">No matches</span>}
          </div></div>
          <div className="card"><div className="tag" style={{ marginBottom: 8 }}>Problems</div><div className="col" style={{ gap: 4 }}>
            {res.problems.map((p: any) => <Link key={p.id} className="hc-link" style={{ background: 'var(--block)' }} to={materialLink(p.material_id, { problem: p.id })}><span className="grow"><b style={{ fontWeight: 500 }}>{p.short_title || p.mtitle}</b> {p.label}{p.title ? `: ${p.title}` : ''}</span></Link>)}
            {!res.problems.length && <span className="small steel">No matches</span>}
          </div></div>
        </div>
      )}
      <div className="grid c2">
        {(['source', 'apply'] as const).map((k) => (
          <div key={k} className="card">
            <h2 className="row" style={{ gap: 8 }}><Icon name={k === 'source' ? 'book' : 'pen'} /> {k === 'source' ? 'Source' : 'Apply'}</h2>
            <div className="small steel" style={{ marginBottom: 12 }}>{k === 'source' ? 'Material that teaches: readings, notes, slides, videos.' : 'Material to practise on: problem sets, in-class problems, exams.'}</div>
            {cats(k).map(([cat, list]) => (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div className="col-head">{cat} <span style={{ fontWeight: 400 }}>{list.length}</span></div>
                <div className="col" style={{ gap: 5 }}>{list.map((m: any) => <MatRow key={m.id} m={{ ...m }} />)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AddMaterial({ course, onClose, onStarted }: { course: any; onClose: () => void; onStarted: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState('');
  const [kind, setKind] = useState<'auto' | 'source' | 'apply'>('auto');
  const [unit, setUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.set('kind', kind);
      if (unit) fd.set('unit', unit);
      fd.set('urls', urls);
      files.forEach((f) => fd.append('files', f));
      await api(`/courses/${course.id}/materials`, { form: fd });
      onStarted();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <h2>Add material</h2>
      <p className="steel small" style={{ marginTop: 6 }}>Drop textbook PDFs, lecture notes, problem sets, exams or your own notes, or paste links: a YouTube video or playlist, a web page, a PDF link or an MIT OpenCourseWare course. Each item is read, split into sections or problems, and linked to the rest of the course.</p>
      <div className={'dropzone' + (over ? ' over' : '')} style={{ marginTop: 14 }} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); setFiles([...files, ...Array.from(e.dataTransfer.files)]); }}>
        <div className="row center"><Icon name="upload" size={18} /><b style={{ fontWeight: 500 }}>Drop files or click to choose</b></div>
        <div className="small steel">PDF or images</div>
        <input ref={input} type="file" multiple hidden accept="application/pdf,image/*" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files || [])]); e.target.value = ''; }} />
      </div>
      {files.length > 0 && <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>{files.map((f, i) => <span key={i} className="chip">{f.name}<button className="btn subtle icon" style={{ padding: 0 }} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button></span>)}</div>}
      <label className="lbl" style={{ marginTop: 14 }}>Links, one per line</label>
      <textarea className="field" placeholder={'https://www.youtube.com/playlist?list=...\nhttps://tutorial.math.lamar.edu/Classes/CalcI/Limits.aspx'} value={urls} onChange={(e) => setUrls(e.target.value)} />
      <div className="row wrap" style={{ marginTop: 14, gap: 14 }}>
        <div>
          <label className="lbl">This is</label>
          <div className="seg">
            {(['auto', 'source', 'apply'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'auto' ? 'Let AI decide' : k === 'source' ? 'Source (to learn from)' : 'Apply (to practise)'}</button>)}
          </div>
        </div>
        {course.units.length > 0 && (
          <div style={{ minWidth: 200 }}>
            <label className="lbl">Unit</label>
            <select className="field" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">No specific unit</option>
              {course.units.map((u: any) => <option key={u.idx} value={u.idx}>{u.idx}. {u.title}</option>)}
            </select>
          </div>
        )}
      </div>
      {err && <div className="notice error" style={{ marginTop: 12 }}>{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn subtle" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || (!files.length && !urls.trim())} onClick={submit}>{busy ? <Spinner /> : <Sparkle className="" />} Add and link</button>
      </div>
    </Modal>
  );
}

function FindPractice({ course, onClose, onStarted }: { course: any; onClose: () => void; onStarted: () => void }) {
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose}>
      <h2 className="row"><Sparkle size={18} /> Find more practice</h2>
      <p className="steel small" style={{ marginTop: 6 }}>An agent searches for reputable problem sets, exams and exercises with solutions that match this course, checks every link, and adds them as Apply material linked to the readings.</p>
      <label className="lbl" style={{ marginTop: 12 }}>Focus (optional)</label>
      <input className="field" placeholder="e.g. Bayesian updating, more exam-style problems" value={focus} onChange={(e) => setFocus(e.target.value)} />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn subtle" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await api(`/courses/${course.id}/find-practice`, { body: { focus } }); onStarted(); }}>{busy ? <Spinner /> : <Sparkle />} Search</button>
      </div>
    </Modal>
  );
}


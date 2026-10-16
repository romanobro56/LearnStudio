// Uploading handwritten work and AI grading it.
import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, materialLink, timeAgo, type Grade, type Submission } from '../api';
import { Icon, Markdown, Sparkle, Spinner } from './ui';

export function UploadWork({ materialId, problemId, onUploaded, compact }: { materialId: string; problemId?: string | null; onUploaded: (s: Submission) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list).filter((x) => /^image\/|pdf$/.test(x.type) || /\.(heic|heif|pdf)$/i.test(x.name))]);
  };
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.set('materialId', materialId);
      if (problemId) fd.set('problemId', problemId);
      files.forEach((f) => fd.append('files', f));
      const s = await api<Submission>('/submissions', { form: fd });
      setFiles([]);
      onUploaded(s);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className={'dropzone' + (over ? ' over' : '')} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
        <div className="row center" style={{ gap: 8 }}><Icon name="camera" size={18} /><b style={{ fontWeight: 500 }}>{compact ? 'Add photos of your work' : 'Drop photos or a PDF of your work'}</b></div>
        {!compact && <div className="steel small" style={{ marginTop: 4 }}>One page or many. Handwriting, diagrams and equations are fine.</div>}
        <input ref={input} type="file" multiple accept="image/*,application/pdf,.heic,.heif" hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </div>
      {files.length > 0 && (
        <div className="block col" style={{ background: 'var(--mist)', gap: 8 }}>
          <div className="thumbs">
            {files.map((f, i) => (
              <div key={i} className="thumb" style={f.type.startsWith('image/') ? { backgroundImage: `url(${URL.createObjectURL(f)})` } : undefined} title={f.name}>
                {!f.type.startsWith('image/') && 'PDF'}
              </div>
            ))}
          </div>
          <div className="row between">
            <span className="small steel">{files.length} page{files.length > 1 ? 's' : ''} ready</span>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn subtle sm" onClick={() => setFiles([])}>Clear</button>
              <button className="btn primary sm" disabled={busy} onClick={send}>{busy ? <Spinner /> : <Icon name="upload" size={14} />} Upload</button>
            </div>
          </div>
        </div>
      )}
      {err && <div className="notice error">{err}</div>}
    </div>
  );
}

export function SubmissionCard({ s, onChange, onDelete }: { s: Submission; onChange: (s: Submission) => void; onDelete: () => void }) {
  const [busy, setBusy] = useState(s.status === 'grading');
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const grade = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ grade: Grade }>(`/submissions/${s.id}/grade`, { method: 'POST' });
      onChange({ ...s, status: 'graded', grade: r.grade, graded_at: Date.now() });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="small"><b style={{ fontWeight: 600 }}>{s.problemId ? 'Your work' : 'Your work, whole assignment'}</b> <span className="steel">, {timeAgo(s.created_at)}, {s.files.length} page{s.files.length > 1 ? 's' : ''}</span></div>
        <button className="btn subtle icon" title="Delete" onClick={async () => { if (confirm('Delete this upload?')) { await api(`/submissions/${s.id}`, { method: 'DELETE' }); onDelete(); } }}><Icon name="trash" size={14} /></button>
      </div>
      <div className="thumbs" style={{ marginBottom: 10 }}>
        {s.files.map((f, i) => (
          <div key={i} className="thumb" style={f.mime.startsWith('image/') && !/hei[cf]/.test(f.mime) ? { backgroundImage: `url(${f.url})` } : undefined} onClick={() => (f.mime.startsWith('image/') ? setZoom(f.url) : window.open(f.url))}>
            {(!f.mime.startsWith('image/') || /hei[cf]/.test(f.mime)) && (f.mime.includes('pdf') ? 'PDF' : 'Image')}
          </div>
        ))}
      </div>
      {!s.grade || s.grade.error ? (
        <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={grade}>
          {busy ? <><Spinner /> Reading your handwriting and grading</> : <><Sparkle /> AI grade this</>}
        </button>
      ) : <GradeView g={s.grade} onRegrade={grade} busy={busy} />}
      {(err || s.grade?.error) && <div className="notice error" style={{ marginTop: 8 }}>{err || s.grade?.error}</div>}
      {zoom && <div className="lightbox" onClick={() => setZoom(null)}><img src={zoom} alt="Your work" /></div>}
    </div>
  );
}

export function GradeView({ g, onRegrade, busy }: { g: Grade; onRegrade?: () => void; busy?: boolean }) {
  const tone = g.percent >= 85 ? 'green' : g.percent >= 60 ? 'amber' : 'red';
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="block col" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 10 }}>
          <div className="grade-score mono">{fmt(g.score)}<span className="steel" style={{ fontSize: 16 }}> / {fmt(g.max)}</span></div>
          <span className={'chip ' + tone}>{g.percent}%</span>
          <span className="grow" />
          <span className="chip blue"><Sparkle size={12} /> AI graded</span>
        </div>
        <Markdown text={g.summary || ''} className="small" />
      </div>
      {g.problems.map((p) => (
        <details key={p.problemId} className="hint" open={g.problems.length === 1}>
          <summary>
            <span className={'dot ' + p.verdict} />
            <span className="grow truncate">{p.label}</span>
            <span className={'verdict ' + p.verdict}>{p.verdict}</span>
            <span className="mono small">{fmt(p.score)}/{fmt(p.max)}</span>
            <Icon name="chev" size={14} className="chev" />
          </summary>
          <div className="body col" style={{ gap: 8 }}>
            <Markdown text={p.feedback} />
            {p.mistakes?.length > 0 && (
              <div><div className="tag" style={{ marginBottom: 4 }}>Mistakes</div><ul className="md" style={{ margin: 0, paddingLeft: 18 }}>{p.mistakes.map((m, i) => <li key={i}><Markdown text={m} /></li>)}</ul></div>
            )}
            {p.transcription && (
              <details><summary className="small steel" style={{ cursor: 'pointer' }}>What the grader read</summary><div className="block" style={{ marginTop: 6 }}><Markdown text={p.transcription} className="small" /></div></details>
            )}
            {p.review?.length > 0 && (
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="tag">Review</span>
                {p.review.map((r) => <ReviewLink key={r.id} id={r.id} label={r.label} />)}
              </div>
            )}
          </div>
        </details>
      ))}
      {onRegrade && <button className="btn subtle sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={onRegrade}>{busy ? <Spinner /> : <Icon name="refresh" size={13} />} Grade again</button>}
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// Resolve a section id to its material lazily.
function ReviewLink({ id, label }: { id: string; label: string }) {
  const [mid, setMid] = React.useState<string | null>(null);
  React.useEffect(() => { api<any>(`/sections/${id}`).then((s) => setMid(s.materialId)).catch(() => {}); }, [id]);
  return mid ? <Link className="chip blue" to={materialLink(mid, { section: id })}>{label}</Link> : <span className="chip">{label}</span>;
}

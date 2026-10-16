import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Meter, Sparkle, Spinner } from '../components/ui';

function useJob(id: string | undefined) {
  const [j, setJ] = useState<any>(null);
  useEffect(() => {
    if (!id) return;
    let stop = false;
    const tick = async () => {
      try {
        const x = await api(`/jobs/${id}`);
        if (!stop) setJ(x);
        if (x.status === 'running' && !stop) setTimeout(tick, 1500);
      } catch { if (!stop) setTimeout(tick, 3000); }
    };
    tick();
    return () => { stop = true; };
  }, [id]);
  return j;
}

export function JobLog({ id, lines = 8 }: { id: string; lines?: number }) {
  const j = useJob(id);
  if (!j) return null;
  return (
    <div className="col" style={{ gap: 2, marginTop: 10 }}>
      {j.log.slice(-lines).map((l: any, i: number) => <div key={i} className="small steel truncate">{l.m}</div>)}
    </div>
  );
}

export function JobPage() {
  const { id } = useParams();
  const j = useJob(id);
  const nav = useNavigate();
  useEffect(() => {
    // As soon as the course exists, it is more useful to watch it fill in.
    if (j?.course_id && (j.status === 'done' || j.done > 0)) {
      const t = setTimeout(() => nav(`/c/${j.course_id}`), j.status === 'done' ? 600 : 2500);
      return () => clearTimeout(t);
    }
  }, [j?.course_id, j?.status, j?.done > 0]);
  if (!j) return <div className="page row steel"><Spinner /> Starting</div>;
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="tag row" style={{ gap: 6 }}><Sparkle size={13} /> {j.type === 'curate' ? 'Research agent' : 'Importer'}</div>
      <h1 style={{ fontSize: 24, marginTop: 6 }}>{j.title}</h1>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          {j.status === 'running' ? <Spinner /> : null}
          <b style={{ fontWeight: 500 }}>{j.status === 'running' ? 'Working' : j.status === 'done' ? 'Done' : j.status === 'error' ? 'Something went wrong' : 'Stopped'}</b>
          {j.total > 0 && <span className="steel small">{j.done} of {j.total} steps</span>}
        </div>
        {j.total > 0 && <Meter value={j.done} total={j.total} />}
        <div className="col" style={{ gap: 3, marginTop: 14 }}>
          {j.log.map((l: any, i: number) => <div key={i} className="small" style={{ color: i === j.log.length - 1 ? 'var(--ink)' : 'var(--steel)' }}>{l.m}</div>)}
        </div>
        {j.course_id && <Link className="btn primary" style={{ marginTop: 16 }} to={`/c/${j.course_id}`}>Open the course</Link>}
      </div>
    </div>
  );
}

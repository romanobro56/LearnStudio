import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Bars, Icon, Sparkle, Spinner } from '../components/ui';

export function Home() {
  const [courses, setCourses] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>('/courses').then(setCourses); }, []);
  return (
    <div className="page">
      <h1>Your courses</h1>
      <p className="steel" style={{ marginTop: 8, maxWidth: 640 }}>Every course is a web of Source material to learn from and Apply material to practise on, linked both ways.</p>
      {!courses ? <div className="row steel" style={{ marginTop: 20 }}><Spinner /> Loading</div> : (
        <div className="grid c3" style={{ marginTop: 22 }}>
          {courses.map((c) => (
            <Link key={c.id} to={`/c/${c.id}`} className="card course-card">
              <div className="row" style={{ gap: 6 }}>
                {c.code && <span className="chip blue">{c.code}</span>}
                <span className="tiny steel">{c.provider}</span>
                {c.status !== 'ready' && <span className="chip amber"><Spinner size={11} /> {c.status}</span>}
              </div>
              <h2>{c.title}</h2>
              <div className="small steel" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.description}</div>
              <div className="grow" />
              <div className="row between small">
                <span className="steel">{c.stats.materials} materials, {c.stats.problems} problems</span>
                <Bars value={c.stats.read + c.stats.solved} total={c.stats.sections + c.stats.problems} />
              </div>
            </Link>
          ))}
          <Link to="/new" className="card course-card" style={{ alignItems: 'flex-start', justifyContent: 'center' }}>
            <span className="unit-num" style={{ background: 'var(--block)' }}><Icon name="plus" /></span>
            <h2>New course</h2>
            <div className="small steel">Tell us what you want to learn, or import a course, a textbook or a playlist.</div>
          </Link>
        </div>
      )}
    </div>
  );
}

const EXAMPLES = ['Linear algebra from scratch, like a first university course', 'Introduction to machine learning with the math behind it', 'Calculus I: limits, derivatives and integrals', 'Organic chemistry reaction mechanisms'];

export function NewCourse() {
  const nav = useNavigate();
  const [goal, setGoal] = useState('');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async (what: string, fn: () => Promise<any>) => {
    setBusy(what); setErr(null);
    try {
      const r = await fn();
      if (r.jobId) nav(`/jobs/${r.jobId}`);
      else if (r.id) nav(`/c/${r.id}`);
    } catch (e: any) { setErr(e.message); setBusy(null); }
  };
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1>New course</h1>
      <div className="card" style={{ marginTop: 22 }}>
        <h2 className="row" style={{ gap: 8 }}><Sparkle size={18} /> Learn something new</h2>
        <p className="steel small" style={{ marginTop: 6 }}>Describe what you want to learn. A research agent searches for the most reputable, widely used free course material (open university courses first, then open textbooks, notes and lecture series), checks every link, and builds the course with readings, practice and solutions linked together.</p>
        <textarea className="field onmist" style={{ marginTop: 10 }} placeholder="I want to learn..." value={goal} onChange={(e) => setGoal(e.target.value)} />
        <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
          {EXAMPLES.map((e) => <button key={e} className="chip onmist" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 12 }} onClick={() => setGoal(e)}>{e}</button>)}
        </div>
        <button className="btn primary" style={{ marginTop: 14 }} disabled={!goal.trim() || !!busy} onClick={() => go('curate', () => api('/courses/curate', { body: { goal } }))}>
          {busy === 'curate' ? <Spinner /> : <Sparkle />} Build my course
        </button>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h2 className="row" style={{ gap: 8 }}><Icon name="link" /> Import from a link</h2>
        <p className="steel small" style={{ marginTop: 6 }}>An MIT OpenCourseWare course, a YouTube playlist, a notes site page or a PDF link.</p>
        <input className="field onmist" style={{ marginTop: 10 }} placeholder="https://ocw.mit.edu/courses/..." value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn primary" style={{ marginTop: 12 }} disabled={!url.trim() || !!busy} onClick={() => go('import', () => api('/courses/import', { body: { url } }))}>
          {busy === 'import' ? <Spinner /> : <Icon name="upload" size={15} />} Import
        </button>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h2 className="row" style={{ gap: 8 }}><Icon name="book" /> Start with your own files</h2>
        <p className="steel small" style={{ marginTop: 6 }}>Create an empty course, then drop in textbooks, lecture notes, homework and exams.</p>
        <div className="row" style={{ marginTop: 10 }}>
          <input className="field onmist" placeholder="Course name" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn" disabled={!title.trim() || !!busy} onClick={() => go('blank', () => api('/courses/blank', { body: { title } }))}>Create</button>
        </div>
      </div>
      {err && <div className="notice error" style={{ marginTop: 14 }}>{err}</div>}
    </div>
  );
}

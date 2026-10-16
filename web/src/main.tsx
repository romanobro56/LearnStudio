import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import 'katex/dist/katex.min.css';
import './styles.css';
import { api } from './api';
import { Icon, Logo } from './components/ui';
import { Home, NewCourse } from './pages/Home';
import { CoursePage } from './pages/CoursePage';
import { MaterialPage, SolutionsDocPage } from './pages/MaterialPage';
import { JobPage } from './pages/JobPage';

function Sidebar() {
  const [courses, setCourses] = useState<any[]>([]);
  const loc = useLocation();
  useEffect(() => { api<any[]>('/courses').then(setCourses).catch(() => {}); }, [loc.pathname]);
  return (
    <nav className="side">
      <Link to="/" className="brand"><Logo /><span>ILE<small>Integrated Learning Environment</small></span></Link>
      <NavLink to="/" end className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}><Icon name="home" /> Home</NavLink>
      <NavLink to="/new" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}><Icon name="plus" /> New course</NavLink>
      <div className="group">Courses</div>
      {courses.map((c) => (
        <NavLink key={c.id} to={`/c/${c.id}`} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} title={c.title}>
          <Icon name="grad" />
          <span className="truncate">{c.code ? `${c.code} ` : ''}{c.title}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function AiNotice() {
  const [s, setS] = useState<any>(null);
  const [, setTick] = useState(0);
  const loc = useLocation();
  useEffect(() => { api('/status').then(setS).catch(() => {}); }, [loc.pathname]);
  const key = 'ile-ai-notice-' + (s?.deepseek || '');
  let hidden = false;
  try { hidden = sessionStorage.getItem(key) === '1'; } catch {}
  if (!s || s.gemini === 'ok' || hidden) return null;
  const none = s.deepseek === 'unavailable';
  return (
    <div className={'notice row ' + (none ? 'error' : 'warn')} style={{ position: 'fixed', bottom: 14, right: 14, zIndex: 60, maxWidth: 420, fontSize: 12.5, alignItems: 'flex-start' }}>
      {none
        ? <span>AI features are paused: the Gemini and DeepSeek accounts are both out of credit. Reading, linked hover cards, official solutions, saved hints and uploads all still work. Top up Gemini at ai.studio/projects (or DeepSeek) and AI comes back without a restart.</span>
        : <span>Gemini is unavailable ({String(s.reason || '').split(':')[0]}), so AI features are running on DeepSeek. Hints, solutions, grading of photos and PDF imports still work; video chaptering needs Gemini.</span>}
      <button className="btn subtle icon" title="Dismiss" onClick={() => { try { sessionStorage.setItem(key, '1'); } catch {} setTick((n) => n + 1); }}><Icon name="x" size={14} /></button>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AiNotice />
      <Routes>
        <Route path="/m/:id" element={<MaterialPage />} />
        <Route path="*" element={
          <div className="shell">
            <Sidebar />
            <main className="main">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/new" element={<NewCourse />} />
                <Route path="/c/:id" element={<CoursePage />} />
                <Route path="/jobs/:id" element={<JobPage />} />
                <Route path="/m/:id/solutions" element={<SolutionsDocPage />} />
              </Routes>
            </main>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

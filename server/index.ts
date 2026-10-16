import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { all, FILES, get, insert, logEvent, now, parse, ROOT, run, uid, update } from './db.ts';
import { jobView, markInterrupted, startJob } from './jobs.ts';
import { addAndProcess, newMaterial, processCourse, processMaterial } from './ingest.ts';
import { importOcw, isOcw } from './importers/ocw.ts';
import { addUrls, curateCourse, findPractice } from './agent.ts';
import { aiStatus, friendlyAiError, probeAi } from './ai.ts';
import { gradeSubmission, MAX_HINTS, mimeOf, nextHint, resetHints, solveMaterial, solveProblem } from './tutor.ts';

markInterrupted();
const app = express();
app.use(express.json({ limit: '5mb' }));
const upload = multer({ dest: path.join(FILES, '_incoming'), limits: { fileSize: 200 * 1024 * 1024 } });

// Route params are always plain strings here; Express 5 types them loosely, so handlers take a simplified request type.
type Req = express.Request<Record<string, string>>;
const wrap = (fn: (req: Req, res: express.Response) => any) => async (req: Req, res: express.Response) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e: any) {
    console.error('[api]', req.method, req.path, e?.message);
    if (!res.headersSent) res.status(500).json({ error: friendlyAiError(e?.message || 'Something went wrong') });
  }
};

// ---------- helpers ----------
function progressMap(courseId: string) {
  const rows = all('SELECT * FROM progress WHERE course_id = ?', courseId);
  return new Map(rows.map((r) => [`${r.item_type}:${r.item_id}`, r]));
}

function courseStats(courseId: string) {
  const s = get(`SELECT
    (SELECT COUNT(*) FROM sections WHERE course_id = ?) sections,
    (SELECT COUNT(*) FROM progress WHERE course_id = ? AND item_type = 'section' AND status = 'read') read,
    (SELECT COUNT(*) FROM problems WHERE course_id = ?) problems,
    (SELECT COUNT(*) FROM progress WHERE course_id = ? AND item_type = 'problem' AND status = 'solved') solved,
    (SELECT COUNT(*) FROM progress WHERE course_id = ? AND item_type = 'problem' AND status = 'attempted') attempted,
    (SELECT COUNT(*) FROM links l JOIN problems p ON p.id = l.problem_id WHERE p.course_id = ?) links,
    (SELECT COUNT(*) FROM materials WHERE course_id = ? AND kind != 'solution') materials,
    (SELECT COUNT(*) FROM materials WHERE course_id = ? AND status IN ('pending','processing')) processing`,
    courseId, courseId, courseId, courseId, courseId, courseId, courseId, courseId);
  const grades = all("SELECT grade FROM submissions WHERE course_id = ? AND status = 'graded'", courseId).map((g) => parse<any>(g.grade, {}).percent).filter((x) => typeof x === 'number');
  return { ...s, avgGrade: grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length) : null, graded: grades.length };
}

function materialRow(m: any, prog: Map<string, any>) {
  const secs = m.kind === 'source' ? all('SELECT id FROM sections WHERE material_id = ?', m.id) : [];
  const probs = m.kind === 'apply' ? all('SELECT id FROM problems WHERE material_id = ?', m.id) : [];
  return {
    id: m.id, kind: m.kind, type: m.type, category: m.category, title: m.title, shortTitle: m.short_title, unit: m.unit_idx,
    status: m.status, statusMsg: m.status_msg, pageCount: m.page_count, summary: m.summary, url: m.url, solutionId: m.solution_id, parentId: m.parent_id, origin: m.origin,
    sections: secs.length, read: secs.filter((s) => prog.get(`section:${s.id}`)?.status === 'read').length,
    problems: probs.length, solved: probs.filter((p) => prog.get(`problem:${p.id}`)?.status === 'solved').length,
    attempted: probs.filter((p) => prog.get(`problem:${p.id}`)?.status === 'attempted').length,
  };
}

function problemBrief(p: any, prog: Map<string, any>) {
  return { id: p.id, materialId: p.material_id, label: p.label, title: p.title, page: p.page, y: p.y, status: prog.get(`problem:${p.id}`)?.status || null };
}

app.get('/api/status', wrap(() => aiStatus()));

// ---------- courses ----------
app.get('/api/courses', wrap(() => all('SELECT * FROM courses ORDER BY created_at DESC').map((c) => ({ ...c, overview: parse(c.overview, {}), stats: courseStats(c.id) }))));

app.get('/api/courses/:id', wrap((req, res) => {
  const c = get('SELECT * FROM courses WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  const prog = progressMap(c.id);
  const mats = all('SELECT * FROM materials WHERE course_id = ? ORDER BY unit_idx, sort', c.id).map((m) => materialRow(m, prog));
  const units = all('SELECT * FROM units WHERE course_id = ? ORDER BY idx', c.id);
  const last = get(`SELECT e.* FROM events e WHERE e.course_id = ? AND e.type = 'open' ORDER BY e.id DESC LIMIT 1`, c.id);
  let resume = null;
  if (last) {
    const m = get('SELECT id, title, kind FROM materials WHERE id = ?', last.ref_id);
    if (m) resume = { materialId: m.id, title: m.title, kind: m.kind, at: last.created_at };
  }
  const jobs = all("SELECT id, type, title, status, done, total, updated_at FROM jobs WHERE course_id = ? ORDER BY created_at DESC LIMIT 5", c.id);
  return { ...c, overview: parse(c.overview, {}), units, materials: mats, stats: courseStats(c.id), resume, jobs };
}));

app.delete('/api/courses/:id', wrap((req) => {
  run('DELETE FROM courses WHERE id = ?', req.params.id);
  fs.rmSync(path.join(FILES, req.params.id), { recursive: true, force: true });
  return { ok: true };
}));

app.post('/api/courses/import', wrap((req) => {
  const url = String(req.body.url || '').trim();
  if (!url) throw new Error('Paste a link to import');
  if (isOcw(url)) {
    const jobId = startJob(null, 'import', `Import ${url}`, async (job) => {
      const courseId = await importOcw(url, job);
      run('UPDATE jobs SET course_id = ? WHERE id = ?', courseId, job.id);
      await processCourse(courseId, job);
    });
    return { jobId };
  }
  const courseId = uid('c_');
  insert('courses', { id: courseId, title: req.body.title || 'New course', provider: 'Imported', status: 'importing', source_url: url, created_at: now() });
  const jobId = startJob(courseId, 'import', `Import ${url}`, async (job) => {
    await addUrls(courseId, [url], 'auto', job);
    const { buildOverview } = await import('./ingest.ts');
    await buildOverview(courseId, job).catch(() => {});
    update('courses', courseId, { status: 'ready' });
  });
  return { jobId, courseId };
}));

app.post('/api/courses/curate', wrap((req) => {
  const goal = String(req.body.goal || '').trim();
  if (!goal) throw new Error('Tell us what you want to learn');
  const jobId = startJob(null, 'curate', `Build a course: ${goal}`, async (job) => { await curateCourse(goal, job); });
  return { jobId };
}));

app.post('/api/courses/blank', wrap((req) => {
  const id = uid('c_');
  insert('courses', { id, title: String(req.body.title || 'Untitled course'), provider: 'My materials', description: req.body.description || '', status: 'ready', created_at: now() });
  return { id };
}));

app.patch('/api/courses/:id', wrap((req) => {
  const { title, description } = req.body;
  update('courses', req.params.id, { title, description });
  return { ok: true };
}));

app.post('/api/courses/:id/find-practice', wrap((req) => {
  const id = req.params.id;
  const jobId = startJob(id, 'practice', 'Find practice material', async (job) => findPractice(id, job, req.body.focus));
  return { jobId };
}));

app.get('/api/courses/:id/jobs', wrap((req) => all('SELECT id, type, title, status, done, total, created_at, updated_at FROM jobs WHERE course_id = ? ORDER BY created_at DESC LIMIT 20', req.params.id)));
app.get('/api/jobs/:id', wrap((req, res) => jobView(req.params.id) || res.status(404).json({ error: 'No such job' })));
app.get('/api/jobs', wrap(() => all("SELECT id, course_id, type, title, status, done, total FROM jobs WHERE status = 'running' ORDER BY created_at DESC")));

// Add files / links to a course.
app.post('/api/courses/:id/materials', upload.array('files', 50), wrap((req) => {
  const courseId = req.params.id;
  const kind = (['source', 'apply', 'auto'].includes(req.body.kind) ? req.body.kind : 'auto') as 'source' | 'apply' | 'auto';
  const unit = req.body.unit ? Number(req.body.unit) : null;
  const urls = String(req.body.urls || '').split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
  const ids: string[] = [];
  for (const f of (req.files as Express.Multer.File[]) || []) {
    const ext = path.extname(f.originalname).toLowerCase();
    const id = uid('m_');
    const rel = `${courseId}/${id}${ext}`;
    fs.mkdirSync(path.join(FILES, courseId), { recursive: true });
    fs.renameSync(f.path, path.join(FILES, rel));
    const isImg = /^image\//.test(f.mimetype);
    const guess = kind === 'auto' ? (/(pset|problem|homework|hw|exam|quiz|exercise|practice|assignment)/i.test(f.originalname) ? 'apply' : /(sol|answer)/i.test(f.originalname) ? 'apply' : 'source') : kind;
    newMaterial({ id, course_id: courseId, kind: guess, type: ext === '.pdf' ? 'pdf' : isImg ? 'image' : 'pdf', category: req.body.category || (guess === 'apply' ? 'problem set' : 'notes'), title: path.basename(f.originalname, ext).replace(/[_-]+/g, ' '), short_title: path.basename(f.originalname, ext).slice(0, 22), file: rel, unit_idx: unit, origin: 'uploaded', meta: { mime: f.mimetype, originalName: f.originalname } });
    ids.push(id);
  }
  // A solutions file uploaded for a specific apply material.
  if (req.body.solutionFor && ids.length) {
    for (const id of ids) {
      update('materials', id, { kind: 'solution', parent_id: req.body.solutionFor, category: 'solutions' });
      update('materials', req.body.solutionFor, { solution_id: id });
    }
  }
  const jobId = startJob(courseId, 'add', `Add ${ids.length + urls.length} item(s)`, async (job) => {
    if (urls.length) await addUrls(courseId, urls, kind, job, unit);
    if (ids.length) await addAndProcess(ids, job);
  });
  return { jobId, ids };
}));

// ---------- materials ----------
app.get('/api/materials/:id', wrap((req, res) => {
  const m = get('SELECT * FROM materials WHERE id = ?', req.params.id);
  if (!m) return res.status(404).json({ error: 'Material not found' });
  const prog = progressMap(m.course_id);
  logEvent(m.course_id, 'open', 'material', m.id);
  const base: any = { ...materialRow(m, prog), courseId: m.course_id, meta: parse(m.meta, {}), course: get('SELECT id, title, code FROM courses WHERE id = ?', m.course_id) };
  delete base.problems;
  delete base.sections;
  if (m.kind === 'source') {
    base.sections = all('SELECT * FROM sections WHERE material_id = ? ORDER BY idx', m.id).map((s) => ({
      id: s.id, idx: s.idx, title: s.title, summary: s.summary, concepts: parse(s.concepts, []), page: s.page, endPage: s.end_page, y: s.y, anchor: s.anchor, tStart: s.t_start, tEnd: s.t_end,
      status: prog.get(`section:${s.id}`)?.status || null,
      problems: all(`SELECT p.*, l.score, l.reason, mm.short_title, mm.title mtitle FROM links l JOIN problems p ON p.id = l.problem_id JOIN materials mm ON mm.id = p.material_id WHERE l.section_id = ? ORDER BY mm.unit_idx, mm.sort, p.idx`, s.id)
        .map((p) => ({ ...problemBrief(p, prog), material: p.short_title || p.mtitle, reason: p.reason, score: p.score })),
    }));
  }
  if (m.kind === 'apply' || m.kind === 'solution') {
    const target = m.kind === 'solution' ? m.parent_id : m.id;
    base.problems = all('SELECT * FROM problems WHERE material_id = ? ORDER BY idx', target).map((p) => ({
      ...problemBrief(p, prog), statement: p.statement, topics: parse(p.topics, []), points: p.points, anchor: p.anchor,
      solutionPage: p.solution_page, solutionY: p.solution_y, hasOfficial: !!p.solution_text,
      sections: all(`SELECT s.id, s.title, s.page, s.y, s.t_start, s.material_id, l.reason, l.score, mm.short_title, mm.title mtitle, mm.type mtype FROM links l JOIN sections s ON s.id = l.section_id JOIN materials mm ON mm.id = s.material_id WHERE l.problem_id = ? ORDER BY l.score DESC`, p.id)
        .map((s) => ({ id: s.id, title: s.title, materialId: s.material_id, material: s.short_title || s.mtitle, page: s.page, y: s.y, tStart: s.t_start, reason: s.reason, score: s.score, type: s.mtype, status: prog.get(`section:${s.id}`)?.status || null })),
    }));
    if (m.kind === 'solution') base.parent = get('SELECT id, title, short_title FROM materials WHERE id = ?', m.parent_id);
    if (m.solution_id && m.solution_id !== m.id) base.solution = get('SELECT id, title, short_title, status FROM materials WHERE id = ?', m.solution_id);
    if (m.solution_id === m.id) base.solution = { id: m.id, title: m.title, inline: true };
    base.generated = get("SELECT id, status, created_at FROM generated WHERE target_type = 'material' AND target_id = ? AND kind = 'solution'", m.id) || null;
    base.submissions = submissionsFor(m.id, null);
  }
  return base;
}));

app.get('/api/materials/:id/file', wrap((req, res) => {
  const m = get('SELECT * FROM materials WHERE id = ?', req.params.id);
  if (!m?.file) return res.status(404).json({ error: 'No file' });
  res.sendFile(path.join(FILES, m.file));
}));

app.delete('/api/materials/:id', wrap((req) => {
  const m = get('SELECT * FROM materials WHERE id = ?', req.params.id);
  if (m?.solution_id && m.solution_id !== m.id) run('DELETE FROM materials WHERE id = ?', m.solution_id);
  run('UPDATE materials SET solution_id = NULL WHERE solution_id = ?', req.params.id);
  run('DELETE FROM materials WHERE id = ?', req.params.id);
  return { ok: true };
}));

app.patch('/api/materials/:id', wrap((req) => {
  const { title, short_title, unit_idx, kind } = req.body;
  update('materials', req.params.id, { title, short_title, unit_idx, kind });
  return { ok: true };
}));

app.post('/api/materials/:id/reprocess', wrap((req) => {
  const m = get('SELECT * FROM materials WHERE id = ?', req.params.id);
  const jobId = startJob(m.course_id, 'reprocess', `Re-read ${m.title}`, async (job) => addAndProcess([m.id], job));
  return { jobId };
}));

app.post('/api/materials/:id/relink', wrap((req) => {
  const m = get('SELECT * FROM materials WHERE id = ?', req.params.id);
  const jobId = startJob(m.course_id, 'link', `Link ${m.title}`, async (job) => {
    const { linkApply, linkSource } = await import('./ingest.ts');
    if (m.kind === 'apply') await linkApply(m.id, job);
    if (m.kind === 'source') await linkSource(m.id, job);
  });
  return { jobId };
}));

app.post('/api/materials/:id/solve', wrap((req) => {
  const m = get('SELECT * FROM materials WHERE id = ?', req.params.id);
  solveMaterial(m.id, !!req.body?.force).catch((e) => console.error('[solve]', e.message));
  return { status: 'running' };
}));

app.get('/api/materials/:id/generated', wrap((req) => get("SELECT * FROM generated WHERE target_type = 'material' AND target_id = ? AND kind = 'solution'", req.params.id) || null));

app.get('/api/sections/:id', wrap((req, res) => {
  const s = get('SELECT s.*, m.title mtitle, m.short_title FROM sections s JOIN materials m ON m.id = s.material_id WHERE s.id = ?', req.params.id);
  if (!s) return res.status(404).json({ error: 'Section not found' });
  return { id: s.id, materialId: s.material_id, title: s.title, page: s.page, material: s.short_title || s.mtitle };
}));

// ---------- problems ----------
app.get('/api/problems/:id', wrap((req, res) => {
  const p = get('SELECT * FROM problems WHERE id = ?', req.params.id);
  if (!p) return res.status(404).json({ error: 'Problem not found' });
  const prog = get('SELECT * FROM progress WHERE item_type = ? AND item_id = ?', 'problem', p.id);
  const hints = all('SELECT idx, text FROM hints WHERE problem_id = ? ORDER BY idx', p.id).slice(0, prog?.hints_shown || 0);
  const m = get('SELECT id, title, short_title, solution_id FROM materials WHERE id = ?', p.material_id);
  const gen = get("SELECT * FROM generated WHERE target_type = 'problem' AND target_id = ? AND kind = 'solution'", p.id);
  return {
    id: p.id, materialId: p.material_id, label: p.label, title: p.title, statement: p.statement, topics: parse(p.topics, []), points: p.points, page: p.page,
    status: prog?.status || null, hints, maxHints: MAX_HINTS,
    official: p.solution_text ? { text: p.solution_text, page: p.solution_page, y: p.solution_y, materialId: m.solution_id, answer: p.answer } : null,
    generated: gen ? { markdown: gen.markdown, created_at: gen.created_at } : null,
    submissions: submissionsFor(p.material_id, p.id),
  };
}));

app.post('/api/problems/:id/hint', wrap((req) => nextHint(req.params.id)));
app.post('/api/problems/:id/hints/reset', wrap((req) => { resetHints(req.params.id); return { ok: true }; }));
app.post('/api/problems/:id/solve', wrap(async (req) => {
  const g = await solveProblem(req.params.id, !!req.body?.force);
  return { markdown: g.markdown, created_at: g.created_at };
}));

// ---------- progress ----------
app.put('/api/progress', wrap((req) => {
  const { itemType, itemId, status } = req.body;
  const table = itemType === 'section' ? 'sections' : 'problems';
  const row = get(`SELECT course_id FROM ${table} WHERE id = ?`, itemId);
  if (!row) throw new Error('Unknown item');
  const cur = get('SELECT * FROM progress WHERE item_type = ? AND item_id = ?', itemType, itemId);
  insert('progress', { item_type: itemType, item_id: itemId, course_id: row.course_id, status: status || null, hints_shown: cur?.hints_shown || 0, updated_at: now() });
  return { ok: true };
}));

// Mark many sections read at once (when a reader scrolls through them).
app.post('/api/progress/sections', wrap((req) => {
  for (const id of (req.body.ids || []) as string[]) {
    const s = get('SELECT course_id FROM sections WHERE id = ?', id);
    const cur = get('SELECT * FROM progress WHERE item_type = ? AND item_id = ?', 'section', id);
    if (s && !cur) insert('progress', { item_type: 'section', item_id: id, course_id: s.course_id, status: 'read', hints_shown: 0, updated_at: now() });
  }
  return { ok: true };
}));

// ---------- submissions ----------
function submissionsFor(materialId: string, problemId: string | null) {
  const rows = problemId
    ? all('SELECT * FROM submissions WHERE material_id = ? AND (problem_id = ? OR problem_id IS NULL) ORDER BY created_at DESC', materialId, problemId)
    : all('SELECT * FROM submissions WHERE material_id = ? ORDER BY created_at DESC', materialId);
  return rows.map((s) => ({ id: s.id, problemId: s.problem_id, kind: s.kind, note: s.note, status: s.status, created_at: s.created_at, graded_at: s.graded_at, files: parse<any[]>(s.files, []).map((f, i) => ({ name: f.name, mime: mimeOf(f.file), url: `/api/submissions/${s.id}/file/${i}` })), grade: parse(s.grade, null) }));
}

app.post('/api/submissions', upload.array('files', 30), wrap((req) => {
  const { materialId, problemId, kind, note } = req.body;
  const m = get('SELECT * FROM materials WHERE id = ?', materialId);
  if (!m) throw new Error('Unknown material');
  const id = uid('sub_');
  const dir = path.join(FILES, m.course_id, 'submissions', id);
  fs.mkdirSync(dir, { recursive: true });
  const files = ((req.files as Express.Multer.File[]) || []).map((f, i) => {
    const ext = path.extname(f.originalname).toLowerCase() || '.jpg';
    const rel = `${m.course_id}/submissions/${id}/${i + 1}${ext}`;
    fs.renameSync(f.path, path.join(FILES, rel));
    return { file: rel, name: f.originalname };
  });
  if (!files.length) throw new Error('Add at least one page');
  insert('submissions', { id, course_id: m.course_id, material_id: m.id, problem_id: problemId || null, kind: kind || 'work', files, note: note || null, status: 'uploaded', created_at: now() });
  if (problemId) {
    const cur = get('SELECT * FROM progress WHERE item_type = ? AND item_id = ?', 'problem', problemId);
    if (!cur?.status) insert('progress', { item_type: 'problem', item_id: problemId, course_id: m.course_id, status: 'attempted', hints_shown: cur?.hints_shown || 0, updated_at: now() });
  }
  return submissionsFor(m.id, problemId || null).find((s) => s.id === id);
}));

app.get('/api/submissions/:id/file/:n', wrap((req, res) => {
  const s = get('SELECT * FROM submissions WHERE id = ?', req.params.id);
  const f = parse<any[]>(s?.files, [])[Number(req.params.n)];
  if (!f) return res.status(404).json({ error: 'No file' });
  res.sendFile(path.join(FILES, f.file));
}));

app.post('/api/submissions/:id/grade', wrap(async (req) => {
  const grade = await gradeSubmission(req.params.id);
  return { grade };
}));

app.delete('/api/submissions/:id', wrap((req) => {
  const s = get('SELECT * FROM submissions WHERE id = ?', req.params.id);
  if (s) fs.rmSync(path.join(FILES, s.course_id, 'submissions', s.id), { recursive: true, force: true });
  run('DELETE FROM submissions WHERE id = ?', req.params.id);
  return { ok: true };
}));

// ---------- search & map ----------
app.get('/api/courses/:id/search', wrap((req) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  if (q.length < 4) return { sections: [], problems: [] };
  const sections = all(`SELECT s.id, s.title, s.summary, s.page, s.material_id, m.short_title, m.title mtitle FROM sections s JOIN materials m ON m.id = s.material_id WHERE s.course_id = ? AND (s.title LIKE ? OR s.summary LIKE ? OR s.concepts LIKE ?) LIMIT 12`, req.params.id, q, q, q);
  const problems = all(`SELECT p.id, p.label, p.title, p.page, p.material_id, m.short_title, m.title mtitle FROM problems p JOIN materials m ON m.id = p.material_id WHERE p.course_id = ? AND (p.title LIKE ? OR p.statement LIKE ? OR p.topics LIKE ?) LIMIT 12`, req.params.id, q, q, q);
  return { sections, problems };
}));

app.get('/api/courses/:id/map', wrap((req) => {
  const id = req.params.id;
  const prog = progressMap(id);
  const sections = all(`SELECT s.id, s.title, s.material_id, m.short_title, m.unit_idx FROM sections s JOIN materials m ON m.id = s.material_id WHERE s.course_id = ? ORDER BY m.unit_idx, m.sort, s.idx`, id).map((s) => ({ ...s, status: prog.get(`section:${s.id}`)?.status || null }));
  const problems = all(`SELECT p.id, p.label, p.title, p.material_id, m.short_title, m.unit_idx FROM problems p JOIN materials m ON m.id = p.material_id WHERE p.course_id = ? ORDER BY m.unit_idx, m.sort, p.idx`, id).map((p) => ({ ...p, status: prog.get(`problem:${p.id}`)?.status || null }));
  const links = all(`SELECT l.problem_id, l.section_id, l.score FROM links l JOIN problems p ON p.id = l.problem_id WHERE p.course_id = ?`, id);
  return { sections, problems, links };
}));

// ---------- static frontend ----------
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Resume work that was interrupted when the server last stopped.
const activeElsewhere = get("SELECT COUNT(*) n FROM jobs WHERE status = 'running' AND updated_at > ?", Date.now() - 5 * 60_000)?.n;
if (!activeElsewhere && process.env.RESUME !== '0') {
  // Courses still being imported: finish the whole pipeline (remaining documents, linking, overview).
  const importing = all("SELECT id, title FROM courses WHERE status IN ('importing', 'linking')");
  for (const c of importing) {
    run("UPDATE materials SET status = 'pending' WHERE course_id = ? AND status = 'processing'", c.id);
    startJob(c.id, 'import', `Finish importing ${c.title}`, (job) => processCourse(c.id, job));
  }
  // Single materials added to finished courses.
  const stuck = all("SELECT id, course_id FROM materials WHERE status IN ('processing', 'pending') AND course_id NOT IN (SELECT id FROM courses WHERE status IN ('importing', 'linking'))");
  const byCourse = new Map<string, string[]>();
  for (const s of stuck) byCourse.set(s.course_id, [...(byCourse.get(s.course_id) || []), s.id]);
  for (const [cid, ids] of byCourse) startJob(cid, 'resume', `Resume ${ids.length} item(s)`, (job) => addAndProcess(ids, job));
}

const PORT = Number(process.env.PORT || 5174);
app.listen(PORT, () => console.log(`ILE server on http://localhost:${PORT}`));
probeAi().then(() => console.log('[ai] status', JSON.stringify(aiStatus())));
// Re-check every 10 minutes so the status (and the in-app notice) follows top-ups.
setInterval(() => { probeAi().catch(() => {}); }, 10 * 60_000);

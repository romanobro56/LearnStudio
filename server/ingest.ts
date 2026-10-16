// Turning raw materials into understood, linked course content.
import fs from 'node:fs';
import path from 'node:path';
import { all, FILES, get, insert, now, parse, run, tx, uid, update } from './db.ts';
import { docPart, geminiJSON, type Part } from './ai.ts';
import { extractPages, locate, pageText, storePages, subPdf } from './pdf.ts';
import { analyzeApply, analyzeSolutions, analyzeSource, type ProblemOut, type SectionOut } from './analyze.ts';
import type { Job } from './jobs.ts';

const CHUNK = 30; // pages per AI call for long PDFs

export function courseName(courseId: string) {
  const c = get('SELECT title, code FROM courses WHERE id = ?', courseId);
  return c ? [c.code, c.title].filter(Boolean).join(' ') : 'Course';
}

export async function download(url: string, dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (ILE course importer)' }, signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return;
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

export function materialFile(m: any) {
  return m.file ? path.join(FILES, m.file) : '';
}

async function ensureFile(m: any) {
  if (m.type !== 'pdf') return;
  if (m.file && fs.existsSync(path.join(FILES, m.file))) return;
  const rel = `${m.course_id}/${m.id}.pdf`;
  await download(m.url, path.join(FILES, rel));
  update('materials', m.id, { file: rel });
  m.file = rel;
}

// Run an analyzer over a PDF, splitting long documents into page chunks.
async function overPdf<T>(m: any, pages: number, fn: (doc: Part, offset: number, count: number) => Promise<T>, chunk = CHUNK): Promise<{ r: T; offset: number }[]> {
  const file = materialFile(m);
  if (pages <= chunk + Math.ceil(chunk / 3)) return [{ r: await fn(await docPart(file, 'application/pdf', m.title), 0, pages), offset: 0 }];
  const chunks: Promise<{ r: T; offset: number }>[] = [];
  for (let from = 1; from <= pages; from += chunk) {
    const to = Math.min(pages, from + chunk - 1);
    chunks.push((async () => {
      const buf = await subPdf(file, from, to);
      const part: Part = { inline_data: { mime_type: 'application/pdf', data: buf.toString('base64') } };
      return { r: await fn(part, from - 1, to - from + 1), offset: from - 1 };
    })());
  }
  return Promise.all(chunks);
}

function saveSections(m: any, list: SectionOut[]) {
  tx(() => {
    run('DELETE FROM sections WHERE material_id = ?', m.id);
    list.forEach((s, i) => {
      const loc = m.type === 'pdf' ? locate(m.id, s.anchor, s.page) : null;
      if (m.type !== 'pdf') { s.page = undefined; s.endPage = undefined; }
      insert('sections', {
        id: uid('s_'), material_id: m.id, course_id: m.course_id, idx: i, title: s.title, summary: s.summary,
        concepts: s.concepts || [], page: loc?.page ?? s.page ?? null, end_page: s.endPage ?? s.page ?? null,
        y: loc?.y ?? null, anchor: s.anchor || null, t_start: m.type === 'youtube' ? s.tStart ?? null : null, t_end: m.type === 'youtube' ? s.tEnd ?? null : null,
      });
    });
  });
}

function saveProblems(m: any, list: ProblemOut[]) {
  tx(() => {
    run('DELETE FROM problems WHERE material_id = ?', m.id);
    list.forEach((p, i) => {
      const loc = m.type === 'pdf' ? locate(m.id, p.anchor || p.label, p.page) : null;
      insert('problems', {
        id: uid('p_'), material_id: m.id, course_id: m.course_id, idx: i, label: String(p.label || `Problem ${i + 1}`).replace(/[.:]+\s*$/, ''), title: p.title || null,
        statement: p.statement, topics: p.topics || [], points: p.points ?? null, page: loc?.page ?? p.page ?? null,
        y: loc?.y ?? null, anchor: p.anchor || null, answer: p.answer || null,
      });
    });
  });
}

const labelKey = (s: string) => {
  const m = String(s || '').toLowerCase().match(/(problem|question|exercise|concept question|board question|q|p)?\.?\s*(\d+[a-z]?)/);
  return m ? m[2] : String(s || '').toLowerCase().trim();
};

async function applySolutions(sol: any, parent: any, doc: () => Promise<{ r: any; offset: number }[]>) {
  const problems = all('SELECT * FROM problems WHERE material_id = ? ORDER BY idx', parent.id);
  if (!problems.length) return 0;
  const results = await doc();
  let n = 0;
  const used = new Set<string>();
  const norm = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const match = (raw: string) => {
    const full = norm(raw);
    const head = norm(String(raw || '').split(/[:—–]/)[0]);
    const free = problems.filter((x) => !used.has(x.id));
    return free.find((x) => norm(x.label) === full) || free.find((x) => norm(x.label) === head)
      || free.find((x) => full.startsWith(norm(x.label) + ':') || full.startsWith(norm(x.label) + ' '))
      || free.find((x) => labelKey(x.label) === labelKey(head) && norm(x.label).replace(/[\d.]+.*$/, '') === head.replace(/[\d.]+.*$/, ''));
  };
  for (const { r, offset } of results) {
    for (const s of r.solutions || []) {
      const p = match(s.label);
      if (!p || !s.solution) continue;
      used.add(p.id);
      const loc = sol.type === 'pdf' ? locate(sol.id, s.anchor, (s.page || 1) + offset) : null;
      update('problems', p.id, {
        solution_text: s.solution, solution_page: loc?.page ?? (s.page ? s.page + offset : null), solution_y: loc?.y ?? null,
        solution_source: 'official', answer: s.answer || p.answer,
      });
      n++;
    }
  }
  return n;
}

// Understand one material. Solutions require their parent apply material to be processed first.
export async function processMaterial(materialId: string, job?: Job) {
  const m = get('SELECT * FROM materials WHERE id = ?', materialId);
  if (!m) return;
  const course = courseName(m.course_id);
  update('materials', m.id, { status: 'processing', status_msg: null });
  try {
    if (m.type === 'pdf') {
      await ensureFile(m);
      const pages = await extractPages(materialFile(m));
      storePages(m.id, pages);
      update('materials', m.id, { page_count: pages.length });
      if (m.kind === 'source') {
        const res = await overPdf(m, pages.length, (doc, off, count) => analyzeSource(doc, { title: m.title, course, pages: count, text: pageText(m.id, off + 1, off + count) }));
        const sections: SectionOut[] = res.flatMap(({ r, offset }) => (r.sections || []).map((s) => ({ ...s, page: (s.page || 1) + offset, endPage: (s.endPage || s.page || 1) + offset })));
        saveSections(m, sections);
        update('materials', m.id, { summary: res[0]?.r.summary, meta: { ...parse(m.meta, {}), keyConcepts: res.flatMap((x) => x.r.keyConcepts || []) } });
        job?.log(`Read "${m.title}": ${sections.length} sections`);
      } else if (m.kind === 'apply') {
        const res = await overPdf(m, pages.length, (doc, off, count) => analyzeApply(doc, { title: m.title, course, pages: count, text: pageText(m.id, off + 1, off + count) }));
        const problems: ProblemOut[] = res.flatMap(({ r, offset }) => (r.problems || []).map((p) => ({ ...p, page: (p.page || 1) + offset })));
        saveProblems(m, problems);
        update('materials', m.id, { summary: res[0]?.r.summary });
        job?.log(`Read "${m.title}": ${problems.length} problems`);
        if (res.some((x) => x.r.hasSolutions)) {
          try {
            const n = await applySolutions(m, m, () => overPdf(m, pages.length, (doc, off, count) => analyzeSolutions(doc, { title: m.title, course, problems, text: pageText(m.id, off + 1, off + count) }), 12));
            if (n) update('materials', m.id, { solution_id: m.id });
          } catch (e: any) { job?.log(`Could not extract the solutions inside "${m.title}": ${e.message}`); }
        }
      } else if (m.kind === 'solution') {
        const parent = m.parent_id ? get('SELECT * FROM materials WHERE id = ?', m.parent_id) : null;
        if (parent) {
          for (let i = 0; i < 200 && !['ready', 'error'].includes(get('SELECT status FROM materials WHERE id = ?', parent.id)?.status); i++) {
            await new Promise((r) => setTimeout(r, 3000));
          }
          const probs = all('SELECT label, statement FROM problems WHERE material_id = ? ORDER BY idx', parent.id);
          const n = await applySolutions(m, parent, () => overPdf(m, pages.length, (doc, off, count) => analyzeSolutions(doc, { title: m.title, course, problems: probs, text: pageText(m.id, off + 1, off + count) }), 12));
          update('materials', parent.id, { solution_id: m.id });
          job?.log(`Matched ${n} solutions in "${m.title}"`);
        }
      }
    } else if (m.type === 'youtube') {
      try {
        const r = await analyzeSource({ file_data: { file_uri: m.url }, video_metadata: { fps: 0.2 } }, { title: m.title, course, isVideo: true });
        saveSections(m, r.sections || []);
        update('materials', m.id, { summary: r.summary, meta: { ...parse(m.meta, {}), keyConcepts: r.keyConcepts } });
        job?.log(`Watched "${m.title}": ${r.sections?.length || 0} chapters`);
      } catch (e: any) {
        // Only Gemini can watch a video. Without it, keep the video as one chapter so it can still be linked by topic.
        const r = await geminiJSON<{ summary: string; concepts: string[] }>({ parts: [{ text: `Course: ${course}\nA lecture video is titled "${m.title}". From the title alone, write a one-sentence summary of what it most likely covers and 3-6 concept names. Return JSON {"summary": "...", "concepts": ["..."]}` }] }).catch(() => ({ summary: '', concepts: [] }));
        saveSections(m, [{ title: m.title, summary: r.summary || 'Full lecture', concepts: r.concepts || [], tStart: 0 }]);
        update('materials', m.id, { summary: r.summary, status_msg: 'Chapters need Gemini; added as one section' });
        job?.log(`Added "${m.title}" without chapters (${String(e.message).slice(0, 60)})`);
      }
    } else if (m.type === 'web') {
      await processWeb(m, course);
      job?.log(`Read web page "${m.title}"`);
    } else if (m.type === 'image') {
      const file = materialFile(m);
      const mime = parse(m.meta, {} as any).mime || 'image/jpeg';
      const part: Part = { inline_data: { mime_type: mime, data: fs.readFileSync(file).toString('base64') } };
      if (m.kind === 'apply') saveProblems(m, (await analyzeApply(part, { title: m.title, course, pages: 1 })).problems || []);
      else saveSections(m, (await analyzeSource(part, { title: m.title, course, pages: 1 })).sections || []);
      run('INSERT OR REPLACE INTO pages (material_id, page, text, items) VALUES (?,?,?,?)', m.id, 1, '', '[]');
    }
    update('materials', m.id, { status: 'ready' });
  } catch (e: any) {
    update('materials', m.id, { status: 'error', status_msg: String(e?.message || e).slice(0, 300) });
    job?.log(`Could not process "${m.title}": ${e?.message || e}`);
  }
}

// Web pages are stored as cleaned HTML whose headings carry ids; sections point at those ids.
async function processWeb(m: any, course: string) {
  const { fetchArticle } = await import('./importers/web.ts');
  const art = await fetchArticle(m.url);
  const rel = `${m.course_id}/${m.id}.html`;
  fs.mkdirSync(path.join(FILES, m.course_id), { recursive: true });
  fs.writeFileSync(path.join(FILES, rel), art.html);
  run('INSERT OR REPLACE INTO pages (material_id, page, text, items) VALUES (?,?,?,?)', m.id, 1, art.text.slice(0, 200000), '[]');
  update('materials', m.id, { file: rel, page_count: 1, title: m.title || art.title });
  const outline = art.headings.map((h) => `#${h.id} [h${h.level}] ${h.text}`).join('\n');
  const isApply = m.kind === 'apply';
  const r = await geminiJSON<any>({
    system: 'You index study material for an integrated learning environment. Never invent content.',
    parts: [{
      text: `Course: ${course}\nWeb page: ${m.title}\nHeadings (id, level, text):\n${outline || '(none)'}\n\nPage text:\n${art.text.slice(0, 120000)}\n\n` +
        (isApply
          ? `List every problem/exercise on this page. Return JSON {"summary": "...", "problems": [{"label": "...", "title": "...", "anchor": "heading id from the list that precedes the problem, or empty", "statement": "full statement in Markdown with LaTeX $...$", "topics": ["..."], "answer": null}]}`
          : `Split the page into logical sections following its headings. Return JSON {"summary": "...", "keyConcepts": ["..."], "sections": [{"title": "...", "anchor": "heading id from the list (e.g. h-3)", "summary": "1-2 sentences", "concepts": ["..."]}]}`) +
        '\nWrite all math in LaTeX with $...$.',
    }],
    thinking: 'low',
  });
  if (isApply) saveProblems(m, r.problems || []);
  else saveSections(m, r.sections || []);
  update('materials', m.id, { summary: r.summary });
}

// ---------- Linking Source <-> Apply ----------

function sectionCatalog(courseId: string) {
  const rows = all(`SELECT s.id, s.title, s.concepts, s.summary, m.short_title, m.title mtitle, m.unit_idx, m.category
    FROM sections s JOIN materials m ON m.id = s.material_id WHERE s.course_id = ? AND m.kind = 'source' ORDER BY m.unit_idx, m.sort, s.idx`, courseId);
  return rows.map((r, i) => ({ key: 'S' + (i + 1), ...r, concepts: parse<string[]>(r.concepts, []) }));
}

function catalogText(cat: ReturnType<typeof sectionCatalog>) {
  return cat.map((s) => `${s.key} | unit ${s.unit_idx ?? '?'} | ${s.short_title || s.mtitle} | ${s.title} | ${s.concepts.join(', ')}`).join('\n');
}

// Link every problem of an apply material to the source sections that teach what it needs.
export async function linkApply(materialId: string, job?: Job) {
  const m = get('SELECT * FROM materials WHERE id = ?', materialId);
  const problems = all('SELECT * FROM problems WHERE material_id = ? ORDER BY idx', materialId);
  const cat = sectionCatalog(m.course_id);
  if (!problems.length || !cat.length) return;
  const plist = problems.map((p, i) => `P${i + 1} | ${p.label}${p.title ? ' (' + p.title + ')' : ''} | topics: ${parse<string[]>(p.topics, []).join(', ')}\n${String(p.statement || '').slice(0, 700)}`).join('\n\n');
  const r = await geminiJSON<{ links: { problem: string; sections: { id: string; score: number; reason: string }[] }[] }>({
    system: 'You are a meticulous teaching assistant building a cross-reference between a course\'s reading material and its practice problems.',
    parts: [{
      text: `Course: ${courseName(m.course_id)}\nPractice material: ${m.title} (unit ${m.unit_idx ?? '?'})\n\nSOURCE SECTIONS (key | unit | material | section | concepts):\n${catalogText(cat)}\n\nPROBLEMS:\n${plist}\n\nFor each problem, choose the 1-4 source sections a student should review to solve it: the sections that teach the specific ideas, formulas or techniques the problem needs. Prefer the most specific section over a general overview, prefer readings over slides when they cover the same idea, and prefer sections from units at or before unit ${m.unit_idx ?? 'N'} when they are equally relevant. Score 0-1 for relevance. The reason is at most 14 words and names the idea the section supplies.\nReturn JSON {"links": [{"problem": "P1", "sections": [{"id": "S12", "score": 0.9, "reason": "..."}]}]}`,
    }],
    thinking: 'low',
  });
  const byKey = new Map(cat.map((c) => [c.key, c.id]));
  // Sections may have been removed while the model was working.
  const live = new Set(all('SELECT id FROM sections WHERE course_id = ?', m.course_id).map((x) => x.id));
  const liveP = new Set(all('SELECT id FROM problems WHERE material_id = ?', materialId).map((x) => x.id));
  tx(() => {
    for (const p of problems) run('DELETE FROM links WHERE problem_id = ?', p.id);
    for (const l of r.links || []) {
      const p = problems[Number(String(l.problem).replace(/\D/g, '')) - 1];
      if (!p || !liveP.has(p.id)) continue;
      for (const s of l.sections || []) {
        const sid = byKey.get(String(s.id).trim());
        if (sid && live.has(sid)) insert('links', { problem_id: p.id, section_id: sid, score: s.score ?? 0.5, reason: s.reason || '' });
      }
    }
  });
  job?.log(`Linked "${m.title}" to the reading material`);
}

// A new source arrives after problems exist: find the existing problems its sections help with.
export async function linkSource(materialId: string, job?: Job) {
  const m = get('SELECT * FROM materials WHERE id = ?', materialId);
  const sections = all('SELECT * FROM sections WHERE material_id = ? ORDER BY idx', materialId);
  const problems = all(`SELECT p.*, m.short_title, m.title mtitle FROM problems p JOIN materials m ON m.id = p.material_id WHERE p.course_id = ? ORDER BY m.unit_idx, m.sort, p.idx`, m.course_id);
  if (!sections.length || !problems.length) return;
  const slist = sections.map((s, i) => `S${i + 1} | ${s.title} | ${parse<string[]>(s.concepts, []).join(', ')} | ${s.summary || ''}`).join('\n');
  const plist = problems.map((p, i) => `P${i + 1} | ${p.short_title || p.mtitle} ${p.label} | ${parse<string[]>(p.topics, []).join(', ')} | ${String(p.statement || '').slice(0, 160).replace(/\s+/g, ' ')}`).join('\n');
  const r = await geminiJSON<{ links: { section: string; problems: { id: string; score: number; reason: string }[] }[] }>({
    system: 'You are a meticulous teaching assistant building a cross-reference between reading material and practice problems.',
    parts: [{ text: `New source material: ${m.title}\nSECTIONS:\n${slist}\n\nEXISTING PROBLEMS:\n${plist}\n\nFor each section, list up to 8 problems where this section directly teaches an idea the problem needs (score >= 0.6 only). Reason: at most 14 words.\nReturn JSON {"links": [{"section": "S1", "problems": [{"id": "P4", "score": 0.8, "reason": "..."}]}]}` }],
    thinking: 'low',
  });
  // Sections or problems may have been removed while the model was working.
  const liveS = new Set(all('SELECT id FROM sections WHERE material_id = ?', materialId).map((x) => x.id));
  const liveP = new Set(all('SELECT id FROM problems WHERE course_id = ?', m.course_id).map((x) => x.id));
  problems.splice(0, problems.length, ...problems.map((p) => (liveP.has(p.id) ? p : null)) as any[]);
  tx(() => {
    for (const l of r.links || []) {
      const s = sections[Number(String(l.section).replace(/\D/g, '')) - 1];
      if (!s || !liveS.has(s.id)) continue;
      for (const x of l.problems || []) {
        const p = problems[Number(String(x.id).replace(/\D/g, '')) - 1];
        if (p) insert('links', { problem_id: p.id, section_id: s.id, score: x.score ?? 0.6, reason: x.reason || '' });
      }
    }
  });
  job?.log(`Linked "${m.title}" to existing practice problems`);
}

// After a material is added to an existing course: process it, then link it both ways.
export async function addAndProcess(materialIds: string[], job: Job) {
  job.total(materialIds.length * 2);
  const mats = materialIds.map((id) => get('SELECT * FROM materials WHERE id = ?', id)).filter(Boolean);
  await Promise.all(mats.filter((m) => m.kind !== 'solution').map(async (m) => { await processMaterial(m.id, job); job.tick(); }));
  await Promise.all(mats.filter((m) => m.kind === 'solution').map(async (m) => { await processMaterial(m.id, job); job.tick(); }));
  for (const m of mats) {
    const fresh = get('SELECT * FROM materials WHERE id = ?', m.id);
    if (!fresh || fresh.status !== 'ready') { job.tick(); continue; }
    try {
      if (fresh.kind === 'apply') await linkApply(fresh.id, job);
      if (fresh.kind === 'source') await linkSource(fresh.id, job);
    } catch (e: any) { job.log(`Linking failed for "${fresh.title}": ${e.message}`); }
    job.tick();
  }
}

// Full pipeline for a freshly imported course.
export async function processCourse(courseId: string, job: Job) {
  update('courses', courseId, { status: 'importing' });
  const mats = all("SELECT * FROM materials WHERE course_id = ? AND status != 'ready' ORDER BY sort", courseId);
  const firsts = mats.filter((m) => m.kind !== 'solution');
  const sols = mats.filter((m) => m.kind === 'solution');
  const applies = () => all("SELECT id, title FROM materials WHERE course_id = ? AND kind = 'apply' AND status = 'ready'", courseId);
  job.total(mats.length + all("SELECT id FROM materials WHERE course_id = ? AND kind = 'apply'", courseId).length + 1);
  job.log(`Reading ${firsts.length} documents`);
  await Promise.all(firsts.map(async (m) => { await processMaterial(m.id, job); job.tick(); }));
  if (sols.length) job.log(`Matching ${sols.length} solution documents to their problems`);
  await Promise.all(sols.map(async (m) => { await processMaterial(m.id, job); job.tick(); }));
  update('courses', courseId, { status: 'linking' });
  job.log('Linking practice problems to the material that teaches them');
  await Promise.all(applies().map(async (m) => {
    try { await linkApply(m.id, job); } catch (e: any) { job.log(`Linking failed for "${m.title}": ${e.message}`); }
    job.tick();
  }));
  await buildOverview(courseId, job);
  job.tick();
  update('courses', courseId, { status: 'ready' });
  job.log('Course is ready');
}

export async function buildOverview(courseId: string, job?: Job) {
  const c = get('SELECT * FROM courses WHERE id = ?', courseId);
  const units = all('SELECT * FROM units WHERE course_id = ? ORDER BY idx', courseId);
  const mats = all("SELECT title, kind, unit_idx, summary FROM materials WHERE course_id = ? AND kind != 'solution' ORDER BY unit_idx, sort", courseId);
  const r = await geminiJSON<{ description: string; outcomes: string[]; prerequisites: string[]; units: { idx: number; summary: string }[] }>({
    parts: [{ text: `Course: ${courseName(courseId)}\nExisting description: ${c.description || ''}\nUnits:\n${units.map((u) => `${u.idx}. ${u.title}`).join('\n')}\nMaterials:\n${mats.map((m) => `[unit ${m.unit_idx}] (${m.kind}) ${m.title}: ${m.summary || ''}`).join('\n').slice(0, 60000)}\n\nWrite a learner-facing overview. Return JSON {"description": "2-3 sentences, plain and specific", "outcomes": ["5-7 things the learner will be able to do"], "prerequisites": ["..."], "units": [{"idx": 1, "summary": "one sentence on what this unit covers"}]}` }],
    thinking: 'low',
  });
  update('courses', courseId, { description: r.description || c.description, overview: { outcomes: r.outcomes, prerequisites: r.prerequisites } });
  for (const u of r.units || []) run('UPDATE units SET summary = ? WHERE course_id = ? AND idx = ?', u.summary, courseId, u.idx);
  job?.log('Wrote the course overview');
}

export function newMaterial(row: Record<string, any>) {
  const id = row.id || uid('m_');
  insert('materials', { status: 'pending', origin: 'imported', created_at: now(), sort: 0, ...row, id });
  return id;
}

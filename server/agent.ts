// Agents that go out and find material: build a course from a goal, or find practice for a course.
import fs from 'node:fs';
import path from 'node:path';
import { all, get, insert, now, ROOT, run, uid, update } from './db.ts';
import { aiStatus, gemini, geminiJSON, parseJSON } from './ai.ts';
import { addAndProcess, courseName, newMaterial, processCourse } from './ingest.ts';
import { importOcw, isOcw } from './importers/ocw.ts';
import { expandYoutube, isYoutube } from './importers/youtube.ts';
import type { Job } from './jobs.ts';

const skill = (name: string) => fs.readFileSync(path.join(ROOT, 'skills', `${name}.md`), 'utf8');

interface Found { url: string; title: string; shortTitle?: string; kind: 'source' | 'apply'; type?: string; category?: string; unit?: number; why?: string; solutionUrl?: string | null }

// Check that a link really exists and see what it is.
async function verify(url: string): Promise<{ ok: boolean; type: 'pdf' | 'web' | 'youtube' | 'ocw'; finalUrl: string }> {
  if (isYoutube(url)) return { ok: true, type: 'youtube', finalUrl: url };
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (ILE)' }, signal: AbortSignal.timeout(30_000) });
    const ct = r.headers.get('content-type') || '';
    r.body?.cancel().catch(() => {});
    const finalUrl = r.url || url;
    if (!r.ok) return { ok: false, type: 'web', finalUrl };
    if (isOcw(finalUrl) && !/\.pdf$/i.test(finalUrl)) return { ok: true, type: 'ocw', finalUrl };
    return { ok: true, type: ct.includes('pdf') || /\.pdf$/i.test(finalUrl) ? 'pdf' : 'web', finalUrl };
  } catch {
    return { ok: false, type: 'web', finalUrl: url };
  }
}

// ---------- research: real search results only ----------
// The model plans queries, Google Search (via Gemini grounding) returns real result URLs, we open those pages and
// collect their PDF / video links, and the model then chooses only from that verified inventory.

interface Candidate { key: string; url: string; title: string; type: 'pdf' | 'page' | 'youtube' | 'ocw'; children: { key: string; url: string; text: string; type: 'pdf' | 'youtube' }[] }

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function planQueries(skillName: string, brief: string): Promise<string[]> {
  const r = await geminiJSON<{ queries: string[] }>({ thinking: 'low', retries: 3, parts: [{ text: `${skill(skillName)}\n\n---\n${brief}\n\nWrite 4-6 diverse web search queries that would find the material described above, following the source priorities (e.g. one for an MIT OpenCourseWare course, one for an open textbook, one for problem sets with solutions, one for a university lecture video playlist). Return JSON {"queries": ["..."]}` }] });
  return (r?.queries || []).slice(0, 6);
}

// Fallback web search when Gemini's grounded search is unavailable.
async function ddgSearch(q: string): Promise<{ url: string; title: string }[]> {
  try {
    const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q.replace(/\bsite:\S+\s+OR\s+/g, '')), { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' }, signal: AbortSignal.timeout(20_000) });
    const html = await r.text();
    const out: { url: string; title: string }[] = [];
    for (const m of html.matchAll(/class="result__a" href="[^"]*uddg=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
      out.push({ url: decodeURIComponent(m[1]), title: m[2].replace(/<[^>]+>/g, '').trim() });
    }
    return out.slice(0, 10);
  } catch { return []; }
}

async function research(queries: string[], job: Job): Promise<Candidate[]> {
  job.log(`Searching the web: ${queries.join('; ')}`);
  const useGemini = aiStatus().gemini === 'ok';
  const res = useGemini
    ? await Promise.all(queries.map((q) => gemini({ parts: [{ text: `Search the web for: ${q}\nBriefly list the most relevant, reputable results.` }], search: true, thinking: 'low', retries: 2, priority: true }).catch(() => null)))
    : [];
  const chunks: { uri: string; title: string }[] = res.flatMap((r) => r?.grounding?.groundingChunks || []).map((c: any) => c.web).filter(Boolean);
  if (!chunks.length) {
    job.log('Using the fallback search engine');
    for (const list of await Promise.all(queries.map(ddgSearch))) for (const x of list) chunks.push({ uri: x.url, title: x.title });
  }
  // Grounding links are redirects; resolve them to the real URLs.
  const resolved = await pool(chunks, 8, async (c: any) => {
    try {
      const r = await fetch(c.uri, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      return { url: r.headers.get('location') || c.uri, title: c.title };
    } catch { return null; }
  });
  const seen = new Set<string>();
  const ocwRoots = new Set<string>();
  const list: { url: string; title: string }[] = [];
  for (const r of resolved) {
    if (!r?.url || seen.has(r.url)) continue;
    seen.add(r.url);
    const o = r.url.match(/^https:\/\/ocw\.mit\.edu\/courses\/[^/?#]+/);
    if (o) ocwRoots.add(o[0] + '/');
    list.push(r);
  }
  job.log(`Search returned ${list.length} pages${ocwRoots.size ? `, including ${ocwRoots.size} OpenCourseWare course(s)` : ''}`);
  const cands: Candidate[] = [];
  let n = 0;
  for (const root of ocwRoots) {
    let title = root;
    try { const { fetchHtml } = await import('./importers/web.ts'); title = ((await fetchHtml(root)).match(/<title>([^<]*)/)?.[1] || root).split('|')[0].trim(); } catch {}
    cands.push({ key: `C${++n}`, url: root, title, type: 'ocw', children: [] });
  }
  const { fetchArticle } = await import('./importers/web.ts');
  const rest = list.filter((x) => !isOcw(x.url) || /\.pdf$/i.test(x.url)).slice(0, 14);
  const opened = await pool(rest, 6, async (x) => {
    const v = await verify(x.url);
    if (!v.ok) return null;
    if (v.type === 'pdf' || v.type === 'youtube') return { url: v.finalUrl, title: x.title, type: v.type, children: [] as Candidate['children'] };
    try {
      const art = await fetchArticle(v.finalUrl);
      const kids = art.links.filter((l) => /\.pdf($|\?)/i.test(l.href) || isYoutube(l.href)).slice(0, 40)
        .map((l) => ({ url: l.href, text: l.text || l.href.split('/').pop() || '', type: (isYoutube(l.href) ? 'youtube' : 'pdf') as 'pdf' | 'youtube' }));
      return { url: v.finalUrl, title: art.title || x.title, type: 'page' as const, children: kids };
    } catch { return { url: v.finalUrl, title: x.title, type: 'page' as const, children: [] }; }
  });
  for (const o of opened) {
    if (!o) continue;
    const key = `C${++n}`;
    cands.push({ key, url: o.url, title: o.title, type: o.type as Candidate['type'], children: o.children.map((c, i) => ({ ...c, key: `${key}.${i + 1}` })) });
  }
  return cands;
}

function inventoryText(cands: Candidate[]) {
  return cands.map((c) => `[${c.key}] ${c.type.toUpperCase()}: ${c.title} <${c.url}>` + c.children.map((k) => `\n   [${k.key}] ${k.type.toUpperCase()} "${k.text}" <${k.url}>`).join('')).join('\n').slice(0, 60000);
}

function resolveRef(cands: Candidate[], ref?: string | null) {
  if (!ref) return null;
  const r = String(ref).replace(/[[\]]/g, '').trim();
  for (const c of cands) {
    if (c.key === r) return c;
    const k = c.children.find((x) => x.key === r);
    if (k) return { ...k, title: k.text };
  }
  return null;
}

export async function curateCourse(goal: string, job: Job): Promise<string> {
  job.log(`Researching the best material for: "${goal}"`);
  const queries = await planQueries('curate-course', `LEARNER GOAL: ${goal}`);
  const cands = await research(queries, job);
  if (!cands.length) throw new Error('Search found nothing usable. Try rephrasing the goal.');
  const plan: any = await geminiJSON({
    thinking: 'low', retries: 3,
    parts: [{ text: `${skill('curate-course')}\n\n---\nLEARNER GOAL: ${goal}\n\nThese are the search results we found and opened. You may ONLY use items from this list, by their [key]:\n${inventoryText(cands)}\n\nDecide how to build the course:\n- If an OCW course in the list fits the goal well, set "primary" to its key; we will import the whole course and you may add at most 3 supplements from other results (e.g. a lecture video playlist or extra practice).\n- Otherwise set "primary": null and assemble the course from individual PDFs, pages and videos.\nReturn JSON {"primary": "C1" | null, "title": "course title", "description": "2 sentences", "units": [{"idx": 1, "title": "..."}], "items": [{"ref": "C2.3", "title": "clear title", "shortTitle": "max 20 chars", "kind": "source" | "apply", "category": "reading|lecture notes|textbook|lecture video|problem set|exam", "unit": 1, "solutionRef": "C2.4" | null, "why": "one line"}]}` }],
  }).catch(() => ({}));
  let courseId: string;
  const prim = resolveRef(cands, plan.primary);
  if (prim && 'type' in prim && prim.type === 'ocw') {
    job.log(`Primary course: ${prim.title}`);
    courseId = await importOcw(prim.url, job);
    update('courses', courseId, { provider: 'Curated by ILE agent', overview: { goal } });
  } else {
    courseId = uid('c_');
    insert('courses', { id: courseId, title: plan.title || goal, code: '', provider: 'Curated by ILE agent', description: plan.description || '', status: 'importing', overview: { goal }, created_at: now() });
    for (const u of plan.units || []) insert('units', { id: uid('u_'), course_id: courseId, idx: u.idx, title: u.title });
  }
  run('UPDATE jobs SET course_id = ? WHERE id = ?', courseId, job.id);
  const items: Found[] = (plan.items || []).map((it: any) => {
    const ref = resolveRef(cands, it.ref);
    const sol = resolveRef(cands, it.solutionRef);
    return ref ? { url: ref.url, title: it.title || ref.title, shortTitle: it.shortTitle, kind: it.kind === 'apply' ? 'apply' : 'source', category: it.category, unit: it.unit, why: it.why, solutionUrl: sol?.url || null } : null;
  }).filter(Boolean);
  const added = await addFound(courseId, items, job, 'agent');
  job.log(`Added ${added.length} curated materials`);
  await processCourse(courseId, job);
  return courseId;
}

async function addFound(courseId: string, items: Found[], job: Job, origin: string): Promise<string[]> {
  const ids: string[] = [];
  // A solutions file shared by several assignments is a general answer key, not that assignment's solutions.
  const solCount = new Map<string, number>();
  for (const it of items) if (it?.solutionUrl) solCount.set(it.solutionUrl, (solCount.get(it.solutionUrl) || 0) + 1);
  for (const it of items) if (it?.solutionUrl && (solCount.get(it.solutionUrl) || 0) > 1) it.solutionUrl = null;
  let sort = (get('SELECT MAX(sort) s FROM materials WHERE course_id = ?', courseId)?.s || 0) + 1;
  for (const it of items) {
    if (!it?.url) continue;
    const v = await verify(it.url);
    if (!v.ok) { job.log(`Skipped (link did not open): ${it.title}`); continue; }
    if (all('SELECT id FROM materials WHERE course_id = ? AND url = ?', courseId, v.finalUrl).length) continue;
    if (v.type === 'ocw') { job.log(`Skipped nested course site: ${it.title}`); continue; }
    if (v.type === 'youtube') {
      const vids = await expandYoutube(v.finalUrl).catch(() => []);
      for (const [i, vd] of vids.slice(0, 40).entries()) {
        ids.push(newMaterial({ course_id: courseId, kind: 'source', type: 'youtube', category: 'lecture video', title: vd.title, short_title: vids.length === 1 ? vd.title.slice(0, 22) : `Video ${i + 1}`, url: vd.url, unit_idx: it.unit ?? null, sort: sort++, origin, meta: { why: it.why } }));
      }
      job.log(`Added ${vids.length} videos from ${it.title}`);
      continue;
    }
    const id = newMaterial({ course_id: courseId, kind: it.kind === 'apply' ? 'apply' : 'source', type: v.type, category: it.category || null, title: it.title, short_title: (it.shortTitle || it.title).slice(0, 24), url: v.finalUrl, unit_idx: it.unit ?? null, sort: sort++, origin, meta: { why: it.why } });
    ids.push(id);
    job.log(`Found: ${it.title}`);
    if (it.kind === 'apply' && it.solutionUrl && it.solutionUrl !== it.url && it.solutionUrl !== v.finalUrl) {
      const sv = await verify(it.solutionUrl);
      if (sv.ok && sv.type === 'pdf') {
        const sid = newMaterial({ course_id: courseId, kind: 'solution', type: 'pdf', category: 'solutions', title: `${it.title} solutions`, short_title: 'Solutions', url: sv.finalUrl, unit_idx: it.unit ?? null, sort: sort++, parent_id: id, origin });
        update('materials', id, { solution_id: sid });
        ids.push(sid);
      }
    }
  }
  return ids;
}

export async function findPractice(courseId: string, job: Job, focus?: string) {
  const c = get('SELECT * FROM courses WHERE id = ?', courseId);
  const units = all('SELECT idx, title FROM units WHERE course_id = ? ORDER BY idx', courseId);
  const mats = all("SELECT title, kind, url FROM materials WHERE course_id = ? AND kind != 'solution'", courseId);
  job.log(`Looking for practice material for ${courseName(courseId)}${focus ? ` (focus: ${focus})` : ''}`);
  const brief = `COURSE: ${courseName(courseId)}\n${c.description || ''}\nUNITS:\n${units.map((u) => `${u.idx}. ${u.title}`).join('\n')}\n${focus ? `LEARNER'S FOCUS: ${focus}\n` : ''}Avoid the course's own site (${c.source_url || 'n/a'}); look for other universities' material.`;
  const queries = await planQueries('find-practice', brief);
  const cands = (await research(queries, job)).filter((x) => !(c.source_url && x.url.startsWith(c.source_url)));
  const have = new Set(mats.map((m) => m.url));
  const plan: any = await geminiJSON({
    thinking: 'low', retries: 3,
    parts: [{ text: `${skill('find-practice')}\n\n---\n${brief}\nALREADY IN THE COURSE:\n${mats.map((m) => `- (${m.kind}) ${m.title}`).join('\n').slice(0, 8000)}\n\nThese are the search results we found and opened. You may ONLY use items from this list, by their [key]. Pick problem sets, exercises and exams (not lecture notes), and pair each with its solutions document when the list has one:\n${inventoryText(cands)}\n\nReturn JSON {"items": [{"ref": "C2.3", "title": "clear title naming the source, e.g. 'Berkeley Stat 134, Homework 2'", "shortTitle": "max 20 chars, e.g. 'Stat 134 HW 2'", "category": "problem set|exam|practice exam|exercises", "unit": 1, "solutionRef": "C2.4" | null, "why": "one line"}]}` }],
  }).catch(() => ({}));
  const items: Found[] = (plan.items || []).map((it: any) => {
    const ref = resolveRef(cands, it.ref);
    const sol = resolveRef(cands, it.solutionRef);
    return ref && !have.has(ref.url) ? { url: ref.url, title: it.title || ref.title, shortTitle: it.shortTitle, kind: 'apply', category: it.category, unit: it.unit, why: it.why, solutionUrl: sol?.url || null } : null;
  }).filter(Boolean).slice(0, 8);
  job.log(`Chose ${items.length} item(s) to add`);
  const ids = await addFound(courseId, items, job, 'agent');
  if (!ids.length) { job.log('No new practice material passed verification'); return; }
  await addAndProcess(ids, job);
  job.log('New practice material is ready');
}

// Add URLs a user pasted (any kind) to a course.
export async function addUrls(courseId: string, urls: string[], kind: 'source' | 'apply' | 'auto', job: Job, unit?: number | null) {
  const items: Found[] = [];
  for (const url of urls) {
    if (isOcw(url) && !/\.pdf$/i.test(url)) {
      job.log('Importing a whole OCW course into this course');
      await importOcw(url, job, courseId);
      continue;
    }
    items.push({ url, title: url, kind: kind === 'apply' ? 'apply' : 'source', unit: unit ?? undefined });
  }
  if (items.length) {
    // Let the model decide what each link is and give it a proper title.
    const v: any = await geminiJSON({ parts: [{ text: `Course: ${courseName(courseId)}\nFor each URL, decide if it is teaching material ("source") or practice ("apply": problems, exercises, exams), and give a clear short title. If you cannot tell from the URL, use "source".\n${items.map((i, k) => `${k + 1}. ${i.url}`).join('\n')}\nReturn JSON {"items": [{"n": 1, "kind": "source", "title": "...", "shortTitle": "max 20 chars"}]}` }] }).catch(() => null);
    for (const x of v?.items || []) {
      const it = items[x.n - 1];
      if (it) { if (kind === 'auto') it.kind = x.kind === 'apply' ? 'apply' : 'source'; it.title = x.title || it.title; it.shortTitle = x.shortTitle; }
    }
  }
  const ids = await addFound(courseId, items, job, 'uploaded');
  const pending = all("SELECT id FROM materials WHERE course_id = ? AND status = 'pending'", courseId).map((r) => r.id);
  await addAndProcess([...new Set([...ids, ...pending])], job);
}

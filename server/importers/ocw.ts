// MIT OpenCourseWare importer: crawls a course site, lets the model classify every resource
// into Source / Apply / Solution, and creates the course with units and materials.
import * as cheerio from 'cheerio';
import { fetchHtml } from './web.ts';
import { geminiJSON } from '../ai.ts';
import { insert, now, run, uid } from '../db.ts';
import { newMaterial } from '../ingest.ts';
import type { Job } from '../jobs.ts';

const OCW = 'https://ocw.mit.edu';

export function isOcw(url: string) {
  return /ocw\.mit\.edu\/courses\/[^/]+/.test(url);
}

function courseRoot(url: string) {
  const m = url.match(/ocw\.mit\.edu\/courses\/([^/?#]+)/);
  if (!m) throw new Error('Not an OCW course URL');
  return { slug: m[1], base: `${OCW}/courses/${m[1]}` };
}

// Page text with every resource link marked as [R:slug] so the model can refer to them.
function pageDigest(html: string, slug: string) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, noscript').remove();
  const res: Record<string, string> = {};
  const yt: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(new RegExp(`/courses/${slug}/resources/([^/]+)/?$`));
    if (m) {
      res[m[1]] = $(el).text().trim().replace(/\s+/g, ' ');
      $(el).replaceWith(` [R:${m[1]}] ${$(el).text()} `);
    }
    const y = href.match(/youtube\.com\/watch\?v=([\w-]{11})|youtu\.be\/([\w-]{11})/);
    if (y) yt.push(y[1] || y[2]);
  });
  $('tr').each((_, el) => { $(el).append('\n'); });
  $('li, p, h1, h2, h3, h4, div').each((_, el) => { $(el).append('\n'); });
  const main = $('main').length ? $('main') : $('#course-content-section').length ? $('#course-content-section') : $('body');
  const text = main.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { text, res, yt };
}

async function pdfUrlFor(base: string, resSlug: string): Promise<string | null> {
  if (resSlug.endsWith('_pdf')) {
    const guess = `${base}/${resSlug.replace(/_pdf$/, '')}.pdf`;
    try {
      const r = await fetch(guess, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
      if (r.ok) return guess;
    } catch {}
  }
  try {
    const html = await fetchHtml(`${base}/resources/${resSlug}/`);
    const m = html.match(/href="([^"]+\.pdf)"/);
    if (m) return new URL(m[1], OCW).toString();
  } catch {}
  return null;
}

async function videoFor(base: string, resSlug: string): Promise<string | null> {
  try {
    const html = await fetchHtml(`${base}/resources/${resSlug}/`);
    const m = html.match(/youtube\.com\/embed\/([\w-]{11})|youtube\.com\/watch\?v=([\w-]{11})|data-videoid="([\w-]{11})"|youtu\.be\/([\w-]{11})/i);
    const id = m && (m[1] || m[2] || m[3] || m[4]);
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch { return null; }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

interface Plan {
  title: string; code: string; description: string;
  units: { idx: number; title: string; group?: string }[];
  materials: { resource: string; title: string; shortTitle: string; kind: 'source' | 'apply' | 'solution' | 'skip'; category: string; unit: number; solutionFor?: string | null }[];
}

export async function importOcw(url: string, job: Job, existingCourseId?: string): Promise<string> {
  const { slug, base } = courseRoot(url);
  job.log(`Opening ${base}`);
  const home = await fetchHtml(base + '/');
  const $ = cheerio.load(home);
  const ogTitle = ($('meta[property="og:title"]').attr('content') || $('title').text()).split('|')[0].trim();
  const desc = ($('meta[name="description"]').attr('content') || '').trim();
  const code = slug.match(/^([a-z0-9]+)-(\d+[a-z]*)/i) ? slug.replace(/^([a-z0-9]+)-(\d+[a-z]*)-.*/i, '$1.$2').toUpperCase() : '';

  // Discover the course's pages (one level of nav + links inside pages).
  const pageSet = new Set<string>();
  const addPages = (html: string) => {
    // Pages can nest several levels deep (unit/part/session) and contain dots ("1.-differentiation").
    for (const m of html.matchAll(new RegExp(`/courses/${slug}/pages/([^"#?]+?)/?["#?]`, 'gi'))) pageSet.add(m[1].replace(/\/$/, ''));
  };
  addPages(home);
  const SKIP = /instructor-insights|teaching|teachers|active-learning|why-teach|about|r-tutorial|using-the-applets|r-and-rstudio|studio-resources|download/;
  const seen = new Map<string, ReturnType<typeof pageDigest>>();
  seen.set('home', pageDigest(home, slug));
  // Breadth-first over the whole site: "SC" (scholar) courses nest sessions several levels deep.
  for (let round = 0; round < 6 && seen.size < 300; round++) {
    const todo = [...pageSet].filter((p) => !seen.has(p) && !SKIP.test(p)).slice(0, 300 - seen.size);
    if (!todo.length) break;
    const htmls = await pool(todo, 8, async (p) => {
      try {
        const html = await fetchHtml(`${base}/pages/${p}/`);
        seen.set(p, pageDigest(html, slug));
        return html;
      } catch { seen.set(p, { text: '', res: {}, yt: [] }); return ''; }
    });
    // Add newly found links in page order so the course keeps the site's ordering.
    htmls.forEach((h) => h && addPages(h));
  }
  job.log(`Read ${seen.size} course pages`);
  const allRes: Record<string, string> = {};
  for (const d of seen.values()) Object.assign(allRes, d.res);
  // Large sites: keep only the lines around resource links so the whole course fits in one request.
  const big = seen.size > 40;
  const compact = (t: string) => {
    if (!big) return t.slice(0, 14000);
    const lines = t.split('\n');
    return lines.filter((l, i) => /\[R:/.test(l) || /\[R:/.test(lines[i + 1] || '') || i < 3).join('\n').slice(0, 4000);
  };
  const digest = [...seen.entries()].filter(([, d]) => d.text).map(([p, d]) => `=== PAGE: ${p}\n${compact(d.text)}`).join('\n\n').slice(0, 320000);
  job.log(`Found ${Object.keys(allRes).length} resources; asking the model to organise them`);

  const plan: Plan = big ? await planInChunks(seen, [...pageSet], code, ogTitle, desc, job) : await (async () => {
  return geminiJSON<Plan>({
    system: 'You organise university course websites into a structured study plan. Be exhaustive and precise; refer to resources only by the [R:slug] markers that appear in the text.',
    parts: [{
      text: `Below is the text of an MIT OpenCourseWare course site. Resource links are marked [R:slug].\n\n${digest}\n\nBuild the course structure:\n- "units": the course's ordered sessions (e.g. each class / lecture / week), idx starting at 1, with a short title. "group" is the larger part it belongs to if the site has one (e.g. "Unit 1: Probability").\n- "materials": every useful resource, in study order. For each: "resource" (the slug from [R:...]), "title" (clear, e.g. "Class 3 Reading: Conditional probability, independence, Bayes' theorem"), "shortTitle" (max 22 chars, e.g. "Reading 3", "Pset 2", "Exam 1", "Slides 4"), "kind":\n   * "source": material that teaches: readings, lecture notes, slides, lecture videos, textbook chapters\n   * "apply": material to practise on: problem sets, in-class problems, recitation problems, practice exams, exams, review problems\n   * "solution": a solutions document for an apply material; set "solutionFor" to that apply material's slug\n   * "skip": duplicates (e.g. an all-in-one compilation of readings that are also listed separately), code files, data files, tables, syllabus/calendar documents, anything not study content, video transcripts and caption files\n  "category": one of reading, lecture notes, slides, lecture video, problem set, in-class problems, exam, practice exam, review, recitation, other.\n  "unit": the unit idx the material belongs to. For problem sets and exams, use the unit at which it is assigned / due (the latest unit whose material it covers), using any calendar information.\nReturn JSON {"title": "course title", "code": "${code}", "description": "1-2 sentences", "units": [...], "materials": [...]}`,
    }],
    thinking: 'low',
    maxTokens: 60000,
  });
  })();

  const courseId = existingCourseId || uid('c_');
  if (!existingCourseId) {
    insert('courses', { id: courseId, title: plan.title || ogTitle, code: plan.code || code, provider: 'MIT OpenCourseWare', description: plan.description || desc, source_url: base + '/', status: 'importing', created_at: now() });
  }
  for (const u of plan.units || []) insert('units', { id: uid('u_'), course_id: courseId, idx: u.idx, title: u.title, grp: u.group || null });

  const wanted = (plan.materials || []).filter((m) => m.kind !== 'skip' && m.resource);
  job.log(`Plan: ${wanted.filter((m) => m.kind === 'source').length} source, ${wanted.filter((m) => m.kind === 'apply').length} apply, ${wanted.filter((m) => m.kind === 'solution').length} solution documents`);
  const resolved = await pool(wanted, 8, async (m) => {
    const slugR = m.resource.replace(/^R:/, '');
    // Video resource pages also link a transcript PDF, so look for the video first when it is one.
    const isVideo = /video|clip|lecture$/i.test(m.category || '') || !slugR.endsWith('_pdf');
    if (isVideo) {
      const vid = await videoFor(base, slugR);
      if (vid) return { m, type: 'youtube', url: vid };
    }
    const pdf = await pdfUrlFor(base, slugR);
    if (pdf) return { m, type: 'pdf', url: pdf };
    if (!isVideo) {
      const vid = await videoFor(base, slugR);
      if (vid) return { m, type: 'youtube', url: vid };
    }
    return null;
  });
  const idBySlug = new Map<string, string>();
  resolved.forEach((r, i) => {
    if (!r) return;
    const id = uid('m_');
    idBySlug.set(r.m.resource.replace(/^R:/, ''), id);
    newMaterial({ id, course_id: courseId, kind: r.m.kind, type: r.type, category: r.m.category, title: r.m.title, short_title: r.m.shortTitle, url: r.url, unit_idx: r.m.unit, sort: i, meta: { ocwResource: r.m.resource } });
  });
  // Pair solutions with their problems.
  resolved.forEach((r) => {
    if (!r || r.m.kind !== 'solution' || !r.m.solutionFor) return;
    const sid = idBySlug.get(r.m.resource.replace(/^R:/, ''));
    const pid = idBySlug.get(String(r.m.solutionFor).replace(/^R:/, ''));
    if (sid && pid) {
      run('UPDATE materials SET parent_id = ? WHERE id = ?', pid, sid);
      run('UPDATE materials SET solution_id = ? WHERE id = ?', sid, pid);
    }
  });
  run("DELETE FROM materials WHERE course_id = ? AND kind = 'solution' AND parent_id IS NULL", courseId);
  job.log(`Created ${idBySlug.size} materials`);
  return courseId;
}


const MATERIAL_RULES = `For each resource: "resource" (the slug from [R:...]), "title" (clear and specific), "shortTitle" (max 22 chars), "kind":
   * "source": teaches: readings, lecture notes, slides, lecture videos, textbook chapters
   * "apply": practice: problem sets, problems, recitation problems, practice exams, exams, review problems
   * "solution": solutions for an apply material on the same page; set "solutionFor" to that material's slug
   * "skip": transcripts, caption files, duplicates, code or data files, anything not study content
  "category": one of reading, lecture notes, slides, lecture video, problem set, exam, practice exam, review, recitation, other.`;

const resourceLines = (text: string) => {
  const lines = text.split('\n');
  return lines.filter((l, i) => /\[R:/.test(l) || /\[R:/.test(lines[i + 1] || '') || i < 3).join('\n').slice(0, 5000);
};

// Large sites (e.g. OCW "SC" courses with one page per session): classify ~20 pages per request, in parallel.
async function planInChunks(seen: Map<string, { text: string; res: Record<string, string> }>, order: string[], code: string, title: string, desc: string, job: Job): Promise<Plan> {
  const pages = ['home', ...order].filter((p, i, a) => a.indexOf(p) === i && seen.get(p)?.text && Object.keys(seen.get(p)!.res).length);
  const chunks: string[][] = [];
  for (let i = 0; i < pages.length; i += 20) chunks.push(pages.slice(i, i + 20));
  job.log(`Organising ${pages.length} pages in ${chunks.length} batches`);
  const results = await pool(chunks, 4, async (chunk) => {
    const text = chunk.map((p) => `=== PAGE: ${p}\n${resourceLines(seen.get(p)!.text)}`).join('\n\n');
    try {
      return await geminiJSON<{ pages: { page: string; title: string; group?: string; materials: Plan['materials'] }[] }>({
        system: 'You organise university course websites into a structured study plan. Refer to resources only by their [R:slug] markers.',
        parts: [{ text: `These are pages of an MIT OpenCourseWare course site ("${title}"). Resource links are marked [R:slug].\n\n${text}\n\nFor each page that has study resources, return its title (the session or exam name, e.g. "Session 4: Limits and continuity"), its "group" (the unit or part it belongs to, judging from the page path, e.g. "Unit 1: Differentiation"), and its materials.\n${MATERIAL_RULES}\nReturn JSON {"pages": [{"page": "the page path exactly as given", "title": "...", "group": "...", "materials": [...]}]}` }],
        thinking: 'low',
        maxTokens: 30000,
      });
    } catch (e: any) {
      job.log(`A batch could not be organised: ${e.message}`);
      return { pages: [] };
    }
  });
  const byPage = new Map<string, { title: string; group?: string; materials: Plan['materials'] }>();
  for (const r of results) for (const p of r.pages || []) byPage.set(p.page, p);
  const units: Plan['units'] = [];
  const materials: Plan['materials'] = [];
  for (const p of pages) {
    const got = byPage.get(p);
    const mats = (got?.materials || []).filter((m) => m.kind !== 'skip' && m.resource);
    if (!mats.length) continue;
    const idx = units.length + 1;
    units.push({ idx, title: got!.title || p.split('/').pop()!.replace(/-/g, ' '), group: got!.group });
    for (const m of mats) materials.push({ ...m, unit: idx });
  }
  return { title, code, description: desc, units, materials };
}

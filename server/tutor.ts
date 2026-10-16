// Hints, AI-written solutions and AI grading, all grounded in the course material.
import fs from 'node:fs';
import path from 'node:path';
import { all, FILES, get, insert, now, parse, run, uid, update } from './db.ts';
import { generateText, geminiJSON, MODELS, type Part } from './ai.ts';
import { extractPages, pageText } from './pdf.ts';
import { courseName } from './ingest.ts';

const MATH = 'Write mathematics in LaTeX with $...$ inline and $$...$$ for display. Use Markdown.';

function linkedSections(problemId: string) {
  return all(`SELECT s.*, l.score, l.reason, m.title mtitle, m.short_title, m.type mtype FROM links l
    JOIN sections s ON s.id = l.section_id JOIN materials m ON m.id = s.material_id
    WHERE l.problem_id = ? ORDER BY l.score DESC`, problemId);
}

function sectionText(s: any, budget = 5000) {
  if (s.mtype === 'pdf' && s.page) return pageText(s.material_id, s.page, Math.max(s.page, s.end_page || s.page)).slice(0, budget);
  return `${s.summary || ''}`;
}

// What the learner has "seen" up to this point: the source materials at or before the problem's unit.
function knownSoFar(courseId: string, unit: number | null) {
  const rows = all(`SELECT title FROM materials WHERE course_id = ? AND kind = 'source' AND (? IS NULL OR unit_idx IS NULL OR unit_idx <= ?) ORDER BY unit_idx, sort`, courseId, unit, unit);
  return rows.map((r) => r.title).join('; ').slice(0, 4000);
}

function problemContext(p: any, opts: { includeSolution?: boolean } = {}) {
  const m = get('SELECT * FROM materials WHERE id = ?', p.material_id);
  const secs = linkedSections(p.id).slice(0, 4);
  const material = secs.map((s) => `--- ${s.short_title || s.mtitle}: ${s.title} (why: ${s.reason})\n${sectionText(s)}`).join('\n\n');
  return {
    m,
    secs,
    text: `Course: ${courseName(p.course_id)}\nAssignment: ${m.title} (unit ${m.unit_idx ?? '?'})\n${p.label}${p.title ? ' (' + p.title + ')' : ''}\n\nPROBLEM STATEMENT:\n${p.statement}\n\nRELEVANT COURSE MATERIAL:\n${material || '(none linked)'}\n\nMaterial covered so far in the course: ${knownSoFar(p.course_id, m.unit_idx)}` +
      (opts.includeSolution && p.solution_text ? `\n\nOFFICIAL SOLUTION (private, for your reference only):\n${p.solution_text}` : ''),
  };
}

export const MAX_HINTS = 5;

export async function nextHint(problemId: string) {
  const p = get('SELECT * FROM problems WHERE id = ?', problemId);
  if (!p) throw new Error('Problem not found');
  const hints = all('SELECT * FROM hints WHERE problem_id = ? ORDER BY idx', problemId);
  const shown = get('SELECT hints_shown FROM progress WHERE item_type = ? AND item_id = ?', 'problem', problemId)?.hints_shown || 0;
  // Reuse a hint that was generated before but not revealed in this progress state.
  if (shown < hints.length) {
    setHintsShown(p, shown + 1);
    return { hints: hints.slice(0, shown + 1), max: MAX_HINTS };
  }
  if (hints.length >= MAX_HINTS) return { hints, max: MAX_HINTS };
  const n = hints.length + 1;
  const ctx = problemContext(p, { includeSolution: true });
  const ladder = [
    'Hint 1: point to the key idea or the section of the course material that applies. Do not set anything up yet.',
    'Hint 2: suggest how to set the problem up (define events/variables, choose the model or formula). No computation.',
    'Hint 3: give the key step or the trick that unlocks the problem, still without the final answer.',
    'Hint 4: walk through the structure of the solution with one intermediate result, leaving the final computation to the student.',
    'Hint 5: give an almost complete outline; the student should only need to finish the last arithmetic. Still do not state the final answer.',
  ];
  const text = await generateText(
    `You are a patient tutor giving progressive hints, exactly like LeetCode's Hint 1, Hint 2, ... Each hint is short (1-4 sentences), builds on the previous ones without repeating them, and never gives away the final answer. When the hint relies on course material, name the section (e.g. "see Reading 3, Bayes' theorem"). ${MATH}`,
    [{ text: `${ctx.text}\n\nHINTS ALREADY GIVEN:\n${hints.map((h) => `Hint ${h.idx}: ${h.text}`).join('\n') || '(none)'}\n\nWrite ${ladder[n - 1]}\nIf the problem has several parts, focus on the part a student would be stuck on first, and mention which part the hint is for. Output only the hint text.` }],
    { priority: true, thinking: 'low' },
  );
  const clean = text.trim().replace(/^#*\s*\**\s*hint\s*\d+\s*[:.]?\s*\**\s*[:.]?\s*/i, '').trim();
  insert('hints', { problem_id: problemId, idx: n, text: clean, created_at: now() });
  setHintsShown(p, n);
  return { hints: all('SELECT * FROM hints WHERE problem_id = ? ORDER BY idx', problemId), max: MAX_HINTS };
}

function setHintsShown(p: any, n: number) {
  const cur = get('SELECT * FROM progress WHERE item_type = ? AND item_id = ?', 'problem', p.id);
  insert('progress', { item_type: 'problem', item_id: p.id, course_id: p.course_id, status: cur?.status || 'attempted', hints_shown: n, updated_at: now() });
}

export async function solveProblem(problemId: string, force = false) {
  const p = get('SELECT * FROM problems WHERE id = ?', problemId);
  const existing = get("SELECT * FROM generated WHERE target_type = 'problem' AND target_id = ? AND kind = 'solution'", problemId);
  if (existing && !force) return existing;
  const ctx = problemContext(p);
  const md = await generateText(
    `You are an expert teaching assistant writing a model solution. Solve using only methods the course has taught up to this point, cite the relevant course sections by name where you use them, show clear reasoning step by step, check your work, and end each part with a bold final answer. ${MATH}`,
    [{ text: `${ctx.text}\n\nWrite the complete worked solution, part by part.` }],
    { priority: true, model: MODELS.vision },
  );
  const row = { id: existing?.id || uid('g_'), course_id: p.course_id, target_type: 'problem', target_id: problemId, kind: 'solution', markdown: md, status: 'ready', created_at: now() };
  insert('generated', row);
  return row;
}

// A whole "solved" document for an assignment that has no official solutions.
export async function solveMaterial(materialId: string, force = false) {
  const m = get('SELECT * FROM materials WHERE id = ?', materialId);
  const existing = get("SELECT * FROM generated WHERE target_type = 'material' AND target_id = ? AND kind = 'solution'", materialId);
  if (existing && !force && existing.status === 'ready') return existing;
  const id = existing?.id || uid('g_');
  insert('generated', { id, course_id: m.course_id, target_type: 'material', target_id: materialId, kind: 'solution', markdown: '', status: 'running', created_at: now() });
  const problems = all('SELECT * FROM problems WHERE material_id = ? ORDER BY idx', materialId);
  try {
    const parts = await Promise.all(problems.map(async (p) => {
      const g = await solveProblem(p.id);
      return `## ${p.label}${p.title ? ': ' + p.title : ''}\n\n${g.markdown}`;
    }));
    const md = `# ${m.title}: worked solutions\n\n*Written by AI from the course material covered up to this point. Check it against your own reasoning.*\n\n${parts.join('\n\n---\n\n')}`;
    update('generated', id, { markdown: md, status: 'ready' });
  } catch (e: any) {
    update('generated', id, { status: 'error', markdown: String(e.message) });
  }
  return get('SELECT * FROM generated WHERE id = ?', id);
}

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif', '.pdf': 'application/pdf', '.gif': 'image/gif' };
export const mimeOf = (f: string) => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

export async function gradeSubmission(submissionId: string) {
  const sub = get('SELECT * FROM submissions WHERE id = ?', submissionId);
  if (!sub) throw new Error('Submission not found');
  update('submissions', sub.id, { status: 'grading' });
  try {
    const m = get('SELECT * FROM materials WHERE id = ?', sub.material_id);
    const problems = sub.problem_id ? all('SELECT * FROM problems WHERE id = ?', sub.problem_id) : all('SELECT * FROM problems WHERE material_id = ? ORDER BY idx', sub.material_id);
    const files: { file: string; name: string }[] = parse(sub.files, []);
    const parts: Part[] = files.map((f) => ({ inline_data: { mime_type: mimeOf(f.file), data: fs.readFileSync(path.join(FILES, f.file)).toString('base64') } }));
    // Typed PDFs can still be graded from their text if the vision model is unavailable.
    let fallbackText = '';
    for (const f of files.filter((x) => mimeOf(x.file) === 'application/pdf')) {
      try { fallbackText += (await extractPages(path.join(FILES, f.file))).map((p) => `[page ${p.page}]\n${p.text}`).join('\n\n'); } catch {}
    }
    const refs: string[] = [];
    const sectionKeys: { key: string; id: string; label: string }[] = [];
    for (const [i, p] of problems.entries()) {
      let ref = p.solution_text ? `Official solution:\n${p.solution_text}` : '';
      if (!ref) {
        const g = get("SELECT markdown FROM generated WHERE target_type = 'problem' AND target_id = ? AND kind = 'solution'", p.id);
        if (g?.markdown) ref = `Reference solution (AI-written, verify independently):\n${g.markdown}`;
      }
      const secs = linkedSections(p.id).slice(0, 4).map((s) => {
        const key = `S${sectionKeys.length + 1}`;
        sectionKeys.push({ key, id: s.id, label: `${s.short_title || s.mtitle}: ${s.title}` });
        return `${key} = ${s.short_title || s.mtitle}: ${s.title}`;
      });
      refs.push(`### Q${i + 1}: ${p.label}${p.title ? ' (' + p.title + ')' : ''} [max points: ${p.points || 10}]\nStatement:\n${p.statement}\n\n${ref || 'No reference solution: solve it yourself carefully before grading.'}\nCourse sections for review: ${secs.join('; ') || 'none'}`);
    }
    const r = await geminiJSON<any>({
      model: MODELS.vision,
      priority: true,
      fallbackText: fallbackText || undefined,
      system: `You are a fair, rigorous grader for ${courseName(sub.course_id)}. You read handwritten work carefully, including equations, tables, tree diagrams and crossed-out text. Award partial credit for correct reasoning even with arithmetic slips, and never credit an answer the work does not support. Be specific and encouraging in feedback. ${MATH}`,
      parts: [
        ...parts,
        {
          text: `The attached ${files.length} page(s) are a student's handwritten work for "${m.title}"${sub.problem_id ? ` (${problems[0]?.label})` : ''}.\n\nPROBLEMS AND REFERENCE SOLUTIONS:\n${refs.join('\n\n')}\n\nGrade each problem above. If the student did not attempt a problem, mark it "missing" with 0 points. For each problem return:\n- "q": "Q1" etc.\n- "score" and "max" (points)\n- "verdict": "correct" | "partial" | "incorrect" | "missing"\n- "transcription": a brief faithful transcription of what the student wrote for it (key steps and final answer)\n- "feedback": 2-5 sentences on what is right and what is wrong, referencing parts (a), (b)...\n- "mistakes": list of specific errors (empty if none)\n- "review": keys of the course sections (S1, S2, ...) the student should revisit, only if they made conceptual mistakes\nAlso return "summary" (2-3 sentences of overall feedback) and "legibility" ("good" | "fair" | "poor").\nReturn JSON {"problems": [...], "summary": "...", "legibility": "good"}`,
        },
      ],
    });
    const keyMap = new Map(sectionKeys.map((k) => [k.key, k]));
    const graded = (r.problems || []).map((g: any) => {
      const p = problems[Number(String(g.q).replace(/\D/g, '')) - 1];
      return {
        problemId: p?.id, label: p?.label || g.q, score: Number(g.score) || 0, max: Number(g.max) || p?.points || 10,
        verdict: g.verdict, transcription: g.transcription, feedback: g.feedback, mistakes: g.mistakes || [],
        review: (g.review || []).map((k: string) => keyMap.get(k)).filter(Boolean),
      };
    }).filter((g: any) => g.problemId);
    const total = graded.reduce((a: number, g: any) => a + g.score, 0);
    const max = graded.reduce((a: number, g: any) => a + g.max, 0);
    const grade = { score: total, max, percent: max ? Math.round((100 * total) / max) : 0, summary: r.summary, legibility: r.legibility, problems: graded, model: MODELS.vision };
    update('submissions', sub.id, { status: 'graded', grade, graded_at: now() });
    for (const g of graded) {
      const status = g.verdict === 'correct' ? 'solved' : 'attempted';
      const cur = get('SELECT * FROM progress WHERE item_type = ? AND item_id = ?', 'problem', g.problemId);
      if (cur?.status === 'solved' && status !== 'solved') continue;
      insert('progress', { item_type: 'problem', item_id: g.problemId, course_id: sub.course_id, status, hints_shown: cur?.hints_shown || 0, updated_at: now() });
    }
    return grade;
  } catch (e: any) {
    const { friendlyAiError } = await import('./ai.ts');
    update('submissions', sub.id, { status: 'error', grade: { error: friendlyAiError(String(e.message || e)) } });
    throw e;
  }
}

export function resetHints(problemId: string) {
  run('UPDATE progress SET hints_shown = 0 WHERE item_type = ? AND item_id = ?', 'problem', problemId);
}

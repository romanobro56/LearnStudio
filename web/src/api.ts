export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const r = await fetch('/api' + path, {
    method: opts.method || (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.form || (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

export interface SectionLink { id: string; title: string; materialId: string; material: string; page?: number; y?: number; tStart?: number; reason?: string; score?: number; type?: string; status?: string | null }
export interface ProblemLink { id: string; materialId: string; label: string; title?: string; page?: number; y?: number; status?: string | null; material?: string; reason?: string; score?: number }
export interface Section { id: string; idx: number; title: string; summary: string; concepts: string[]; page?: number; endPage?: number; y?: number; tStart?: number; tEnd?: number; status: string | null; problems: ProblemLink[] }
export interface Problem extends ProblemLink { statement: string; topics: string[]; points?: number; solutionPage?: number; solutionY?: number; hasOfficial: boolean; sections: SectionLink[] }
export interface Submission { id: string; problemId: string | null; kind: string; status: string; created_at: number; graded_at?: number; files: { name: string; mime: string; url: string }[]; grade: Grade | null }
export interface Grade { score: number; max: number; percent: number; summary: string; legibility?: string; error?: string; problems: { problemId: string; label: string; score: number; max: number; verdict: string; transcription: string; feedback: string; mistakes: string[]; review: { id: string; label: string }[] }[] }

export interface Material {
  id: string; courseId: string; kind: 'source' | 'apply' | 'solution'; type: 'pdf' | 'youtube' | 'web' | 'image'; category?: string; title: string; shortTitle?: string; unit?: number;
  status: string; statusMsg?: string; pageCount?: number; summary?: string; url?: string; solutionId?: string; parentId?: string; meta: any;
  sections?: Section[]; problems?: Problem[]; solution?: { id: string; title: string; inline?: boolean } | null; parent?: { id: string; title: string };
  generated?: { id: string; status: string } | null; submissions?: Submission[]; course: { id: string; title: string; code: string };
  read?: number; solved?: number; attempted?: number;
}

export function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export function fmtTime(sec?: number) {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function materialLink(materialId: string, q?: { section?: string; problem?: string; page?: number }) {
  const p = new URLSearchParams();
  if (q?.section) p.set('section', q.section);
  if (q?.problem) p.set('problem', q.problem);
  if (q?.page) p.set('page', String(q.page));
  const s = p.toString();
  return `/m/${materialId}${s ? '?' + s : ''}`;
}

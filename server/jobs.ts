import { get, insert, now, parse, run, uid, update } from './db.ts';

export interface Job {
  id: string;
  log: (msg: string) => void;
  total: (n: number) => void;
  tick: (n?: number) => void;
}

const running = new Map<string, Promise<void>>();

export function startJob(courseId: string | null, type: string, title: string, fn: (job: Job) => Promise<void>): string {
  const id = uid('job_');
  insert('jobs', { id, course_id: courseId, type, title, status: 'running', done: 0, total: 0, log: '[]', created_at: now(), updated_at: now() });
  const lines: { t: number; m: string }[] = [];
  let done = 0;
  let total = 0;
  let flushTimer: NodeJS.Timeout | null = null;
  const flush = () => {
    flushTimer = null;
    update('jobs', id, { done, total, log: lines.slice(-200), updated_at: now() });
  };
  const soon = () => { if (!flushTimer) flushTimer = setTimeout(flush, 400); };
  const job: Job = {
    id,
    log: (m) => { lines.push({ t: now(), m }); console.log(`[job ${type}] ${m}`); soon(); },
    total: (n) => { total = n; soon(); },
    tick: (n = 1) => { done += n; soon(); },
  };
  const p = (async () => {
    try {
      await fn(job);
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      update('jobs', id, { status: 'done', updated_at: now() });
    } catch (e: any) {
      lines.push({ t: now(), m: 'Failed: ' + (e?.message || String(e)) });
      console.error(`[job ${type}]`, e);
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      update('jobs', id, { status: 'error', updated_at: now() });
    } finally {
      running.delete(id);
    }
  })();
  running.set(id, p);
  return id;
}

export function jobView(id: string) {
  const j = get('SELECT * FROM jobs WHERE id = ?', id);
  if (!j) return null;
  return { ...j, log: parse(j.log, []) };
}

// Jobs that were running when the server stopped are marked so the UI doesn't spin forever.
export function markInterrupted() {
  // Skip jobs that are still being updated (e.g. by a CLI import running alongside the server).
  run("UPDATE jobs SET status = 'interrupted' WHERE status = 'running' AND updated_at < ?", Date.now() - 5 * 60_000);
}

export function waitJob(id: string): Promise<void> {
  return running.get(id) || Promise.resolve();
}

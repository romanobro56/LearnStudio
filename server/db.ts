import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA = path.join(ROOT, 'data');
export const FILES = path.join(DATA, 'files');
fs.mkdirSync(FILES, { recursive: true });

export const db = new DatabaseSync(path.join(DATA, 'ile.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  code TEXT,
  provider TEXT,
  description TEXT,
  source_url TEXT,
  overview TEXT,
  status TEXT DEFAULT 'ready',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT,
  grp TEXT,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- source | apply | solution
  type TEXT NOT NULL,            -- pdf | youtube | web | image
  category TEXT,                 -- reading, slides, lecture video, problem set, exam, notes...
  title TEXT NOT NULL,
  short_title TEXT,
  url TEXT,
  file TEXT,
  unit_idx INTEGER,
  sort INTEGER DEFAULT 0,
  solution_id TEXT,              -- apply -> its solution material
  parent_id TEXT,                -- solution -> the apply material it solves
  status TEXT DEFAULT 'pending', -- pending | processing | ready | error
  status_msg TEXT,
  page_count INTEGER,
  summary TEXT,
  meta TEXT,
  origin TEXT,                   -- imported | uploaded | agent
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS pages (
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  text TEXT,
  items TEXT,
  PRIMARY KEY (material_id, page)
);
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  idx INTEGER,
  title TEXT,
  summary TEXT,
  concepts TEXT,
  page INTEGER,
  end_page INTEGER,
  y REAL,
  anchor TEXT,
  t_start REAL,
  t_end REAL
);
CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  idx INTEGER,
  label TEXT,
  title TEXT,
  statement TEXT,
  topics TEXT,
  points REAL,
  page INTEGER,
  y REAL,
  anchor TEXT,
  solution_page INTEGER,
  solution_y REAL,
  solution_text TEXT,
  solution_source TEXT,
  answer TEXT
);
CREATE TABLE IF NOT EXISTS links (
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  score REAL,
  reason TEXT,
  PRIMARY KEY (problem_id, section_id)
);
CREATE TABLE IF NOT EXISTS hints (
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  text TEXT,
  created_at INTEGER,
  PRIMARY KEY (problem_id, idx)
);
CREATE TABLE IF NOT EXISTS generated (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  target_type TEXT NOT NULL,     -- material | problem
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- solution
  markdown TEXT,
  status TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  problem_id TEXT,
  kind TEXT DEFAULT 'work',      -- work | notes
  files TEXT,
  note TEXT,
  status TEXT DEFAULT 'uploaded',
  grade TEXT,
  graded_at INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS progress (
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  status TEXT,
  hints_shown INTEGER DEFAULT 0,
  updated_at INTEGER,
  PRIMARY KEY (item_type, item_id)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  course_id TEXT,
  type TEXT,
  title TEXT,
  status TEXT,                   -- queued | running | done | error
  done INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  log TEXT DEFAULT '[]',
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT,
  type TEXT,
  ref_type TEXT,
  ref_id TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mat_course ON materials(course_id);
CREATE INDEX IF NOT EXISTS idx_sec_mat ON sections(material_id);
CREATE INDEX IF NOT EXISTS idx_prob_mat ON problems(material_id);
CREATE INDEX IF NOT EXISTS idx_links_sec ON links(section_id);
`);

export const uid = (p = '') => p + crypto.randomBytes(6).toString('base64url');
export const now = () => Date.now();

export function all<T = any>(sql: string, ...args: any[]): T[] {
  return db.prepare(sql).all(...args) as T[];
}
export function get<T = any>(sql: string, ...args: any[]): T | undefined {
  return db.prepare(sql).get(...args) as T | undefined;
}
export function run(sql: string, ...args: any[]) {
  return db.prepare(sql).run(...args);
}

export function insert(table: string, row: Record<string, any>) {
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  const vals = keys.map((k) => norm(row[k]));
  db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...vals);
}
export function update(table: string, id: string, patch: Record<string, any>, key = 'id') {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${key} = ?`).run(...keys.map((k) => norm(patch[k])), id);
}
function norm(v: any) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
export function parse<T = any>(s: any, fallback: T): T {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function logEvent(course_id: string, type: string, ref_type: string, ref_id: string) {
  run('INSERT INTO events (course_id, type, ref_type, ref_id, created_at) VALUES (?,?,?,?,?)', course_id, type, ref_type, ref_id, now());
}

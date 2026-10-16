// Re-run solution matching for assignments where some problems still lack an official solution.
import { all } from '../server/db.ts';
import { processMaterial } from '../server/ingest.ts';
const courseId = process.argv[2];
const sols = all(`SELECT s.id, s.title FROM materials s JOIN materials a ON a.id = s.parent_id
  WHERE s.kind = 'solution' AND s.course_id = ? AND s.status = 'ready'
  AND EXISTS (SELECT 1 FROM problems p WHERE p.material_id = a.id AND p.solution_text IS NULL)`, courseId);
console.log(`Re-matching ${sols.length} solution documents`);
await Promise.all(sols.map(async (s) => { await processMaterial(s.id, { id: '', log: (m) => console.log(m), total: () => {}, tick: () => {} }); }));
console.log('done');
process.exit(0);

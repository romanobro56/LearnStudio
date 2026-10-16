// Usage: node --env-file=.env scripts/import-ocw.ts <ocw course url>
//        node --env-file=.env scripts/import-ocw.ts --resume <courseId>
import { startJob, waitJob } from '../server/jobs.ts';
import { importOcw } from '../server/importers/ocw.ts';
import { processCourse } from '../server/ingest.ts';
import { run } from '../server/db.ts';
const args = process.argv.slice(2);
let id: string;
if (args[0] === '--resume') {
  const courseId = args[1];
  run("UPDATE materials SET status = 'pending' WHERE course_id = ? AND status IN ('processing', 'error')", courseId);
  id = startJob(courseId, 'import', 'Finish importing', (job) => processCourse(courseId, job));
} else {
  const url = args[0] || 'https://ocw.mit.edu/courses/18-05-introduction-to-probability-and-statistics-spring-2022/';
  id = startJob(null, 'import', 'Import ' + url, async (job) => {
    const courseId = await importOcw(url, job);
    run('UPDATE jobs SET course_id = ? WHERE id = ?', courseId, job.id);
    await processCourse(courseId, job);
  });
}
await waitJob(id);
console.log('JOB finished');
process.exit(0);

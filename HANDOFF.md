# ILE handoff

This document is for whoever picks up ILE next. It covers how to build and run it, the state it was left in,
what to do next, and the design decisions that are not obvious from reading the code. For a shorter, user-facing
overview see [README.md](README.md).

## 1. What ILE is

ILE (Integrated Learning Environment) is a local web app for studying a subject. You give it course material
(PDF textbooks and notes, YouTube lectures, web pages, a whole MIT OpenCourseWare course) or just a learning goal,
and it builds a course where every item is either:

- **Source**: material that teaches (readings, lecture notes, slides, textbooks, lecture videos), split into sections.
- **Apply**: material to practise on (problem sets, in-class problems, exams), split into problems.
- **Solution**: an official solutions document, matched problem by problem to its Apply material.

Every problem is linked to the sections that teach what it needs, and every section knows the problems that use it.
The reader shows these links as margin markers with hover cards. Each problem has LeetCode-style progressive hints,
its official or AI-written solution, and an upload area where a photo of handwritten work can be graded by a vision
model.

## 2. Build and run

### Requirements

- **Node 22.18 or newer.** The server is TypeScript run directly by Node's built-in type stripping; there is no
  server build step. Developed and tested on Node 26.
- A Gemini API key (required for the full experience) and optionally a DeepSeek key (fallback).
- No database server: SQLite comes from `node:sqlite`, built into Node.

### First run

```bash
cd ile
npm install
cp .env.example .env        # then fill in GEMINI_API_KEY (and DEEPSEEK_API_KEY)
npm run build               # builds the React app into dist/
npm run server              # http://localhost:5174
```

`npm start` does build + server in one go. On Windows, `start.cmd` runs the server (after a build).

npm 11 blocks install scripts by default; if Vite complains about esbuild, run `npm install-scripts approve esbuild`
(already recorded under `allowScripts` in package.json).

### Development

- Server: `npm run server` (restart it after server changes; there is no watch mode).
- Frontend with hot reload: `npm run dev:web` (Vite on :5173, proxies `/api` to :5174).
- Type check everything: `npm run typecheck` (clean at handoff).

### Importing courses from the command line

```bash
npm run import:ocw -- https://ocw.mit.edu/courses/18-05-introduction-to-probability-and-statistics-spring-2022/
npm run import:ocw -- --resume <courseId>     # finish an interrupted import
npm run rematch:solutions -- <courseId>       # re-match solutions where problems still lack one
```

The same imports are available in the UI (New course, Add material, Find more practice). A CLI import can run while
the server is up; both use the same SQLite file.

### Environment variables

See `.env.example`. Keys are read only on the server and are never sent to the browser.

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | | Required for PDF/video understanding and agent web search |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Reading, linking, hints, agents |
| `GEMINI_VISION_MODEL` | `gemini-pro-latest` | Worked solutions and grading |
| `DEEPSEEK_API_KEY` | | Fallback provider |
| `DEEPSEEK_MODEL` | `deepseek-flash` | Fallback model (reads text and images) |
| `PORT` | `5174` | Server port |
| `AI_CONCURRENCY` | `6` | Parallel Gemini calls for imports |
| `DEEPSEEK_CONCURRENCY` | `12` | Parallel DeepSeek calls for imports |
| `RESUME` | on | `0` stops the server from resuming interrupted imports at startup |

## 3. State at handoff

- **Both AI accounts were out of credit** at the end of the session (Gemini: 402 "prepayment credits are depleted";
  DeepSeek: 402 "Insufficient Balance"). The app handles this: reading, hover cards, official solutions, cached hints
  and uploads keep working, AI buttons return a clear message, and a red notice explains it. The server re-checks both
  providers every 10 minutes, so AI returns on its own after a top-up.
- **Local data** lives in `data/` (git-ignored): `data/ile.db` plus downloaded PDFs and uploads in `data/files/`.
  It is about 150 MB and is not part of the repository. A fresh clone starts empty; re-import with the commands above.
- Courses in the local database at handoff:
  - **MIT 18.05 Introduction to Probability and Statistics** (Spring 2022), imported from OCW: 29 units, 63 Source and
    48 Apply documents, 498 problems with 496 matched official solutions. Also added: 3 MIT 6.041 lecture videos with
    AI chapters, the 518-page Grinstead & Snell textbook (231 sections), and practice found by the agent (Harvard Stat
    110 sets, MIT 18.440 and 18.600 finals). About 2,500 Source-Apply links; every problem is linked.
  - **18.01SC Single Variable Calculus**, built by the "learn something new" agent from a one-line goal: MIT 18.01SC
    plus OpenStax Calculus Volume 1 and Paul's Online Notes. 557 materials, 1,168 problems (923 with official
    solutions), 3,437 links. Its AI course overview is missing (credits ran out), so the description was written by hand.
  - One demo upload is kept on 18.05 Problem Set 2, Problem 1: a generated photo of handwritten work with a planted
    error in part (b), graded 14/20.

## 4. Architecture

```
ile/
  server/
    index.ts        Express routes, static hosting of dist/, startup resume and AI probing
    db.ts           SQLite schema (CREATE IF NOT EXISTS) and tiny query helpers
    ai.ts           Gemini + DeepSeek clients, provider fallback, JSON repair, rate limiting
    pdf.ts          pdf.js text extraction with line positions, anchor lookup, PDF splitting
    analyze.ts      Prompts that turn a document into sections / problems / solutions
    ingest.ts       Per-material processing, Source<->Apply linking, course overview, full-course pipeline
    tutor.ts        Hints, worked solutions, solved documents, grading
    agent.ts        Research agents: build a course from a goal, find practice, add pasted links
    jobs.ts         In-process background jobs with progress logs (stored in the jobs table)
    importers/      ocw.ts (OpenCourseWare crawler), web.ts (readable HTML), youtube.ts (videos/playlists)
  skills/           Markdown "skills" the agents follow (curate-course.md, find-practice.md)
  scripts/          CLI import and re-match scripts
  web/src/          React app (Vite): pages/, components/, api.ts, styles.css
```

### Data model (server/db.ts)

- `courses`, `units` (ordered sessions, with an optional group like "Unit 1: Probability").
- `materials`: one row per document/video/page. `kind` is source | apply | solution. A solution row has `parent_id`
  pointing at its Apply material, and the Apply row has `solution_id`. **`solution_id = id` means the document
  contains its own solutions** (common for exam "solutions" PDFs and Harvard Stat 110 sets).
- `pages`: per-page text and line positions for PDFs (used for anchors, AI context and the DeepSeek fallback).
- `sections` (Source) and `problems` (Apply). Problems carry their official solution text and its page/position.
- `links(problem_id, section_id, score, reason)`: the Source-Apply web.
- `hints`, `generated` (AI solutions), `submissions` (uploads + grade JSON), `progress`, `jobs`, `events`.

JSON-ish columns (concepts, topics, meta, grade, files, log) are stored as TEXT and parsed with `parse()`.
There are no migrations: the schema is `CREATE TABLE IF NOT EXISTS`, so **adding a column to an existing database
needs a manual `ALTER TABLE`** (or delete `data/ile.db` and re-import).

## 5. Design decisions and considerations

These are the choices that are not obvious from the code, and the traps found while building.

### Running TypeScript without a build

- The server runs with Node's type stripping, which means **no enums, no constructor parameter properties, no
  namespaces, and relative imports must include the `.ts` extension**. A parameter property crashed the server once.
- `tsx` was removed; `npm run typecheck` (tsc, no emit) is the only type check.

### Understanding documents

- **Gemini reads PDFs natively** (sent inline, or via the Files API above ~14 MB). This is far better for math than
  extracted text. Long PDFs are split with pdf-lib into 30-page chunks (12 pages for solution documents, because their
  output is long), analysed in parallel, and page numbers are offset back.
- **Placing markers**: the model returns a verbatim `anchor` phrase (heading or first words) and a page. The server
  searches pdf.js's text lines for the normalised anchor, trying progressively shorter prefixes, nearest page first,
  and stores `page` + `y` (0-1 from the top). The client only places markers at stored positions. If the anchor is not
  found, the marker sits near the top of the page the model gave.
- **Solutions are matched by label.** Models echo labels with the problem text appended ("Problem II.1: The gamma
  ..."), and naive digit matching mapped "II.1" onto "I.1". `applySolutions` strips anything after a colon, tries exact
  label, then label prefix, then number plus prefix, and never assigns two solutions to one problem.
- **The Gemini recitation filter** sometimes refuses to transcribe copyrighted text (`finishReason: RECITATION`).
  The client retries once, asking for a faithful restatement that keeps all math and results. Solution extraction
  failing never fails the whole document.
- **JSON with LaTeX is fragile.** Models emit unescaped backslashes (`\{`, `\sum`) and stray `\"` at string ends, and
  valid-looking escapes silently corrupt LaTeX (`\frac` becomes a form feed + "rac", `\neq` becomes newline + "eq").
  `parseJSON` in ai.ts repairs invalid escapes with a string-aware scanner and then undoes known control-character
  collisions. The `\n` heuristics are deliberately narrow (`\neq`, `\nu`, `\nabla`, ...) because real newlines are
  common. Failed parses are dumped to `data/debug/` for inspection.
- Video understanding uses Gemini directly on the YouTube URL at low media resolution and 0.2 fps (about 20 s per
  lecture). Chapters come back as `tStart`/`tEnd`; the reader seeks the embedded player with the YouTube iframe API.

### Linking Source and Apply

- **One call per Apply material**, given a catalog of every section in the course as short keys (`S12 | unit | material |
  section | concepts`). Short keys keep the prompt small and stop the model inventing ids. A link run replaces that
  material's links; it deletes only after the model has answered, so a failed call never loses links.
- The model is told to prefer the most specific section, readings over slides, and sections from units at or before the
  problem's unit.
- **New Source added later** is linked the other way (`linkSource`): its sections against the existing problem catalog,
  adding links without removing any.
- Both link functions re-check which sections and problems still exist before inserting, because things can be deleted
  while the model is thinking (this once failed a whole transaction on a foreign key).
- **Unit semantics**: a problem set's unit is the unit where it is assigned or due (the latest material it covers),
  taken from the OCW calendar when available. "What the learner knows so far" for AI solutions is every Source item in
  units up to that one.

### Tutor features

- **Hints** are generated one at a time on request, each prompted with the previous hints and the private official
  solution, following a fixed ladder (idea, setup, key step, structure, near-complete; never the answer). They are cached
  in `hints`; how many are revealed is per-learner state in `progress.hints_shown`, so "reset" hides them without
  regenerating.
- **Worked solutions** use the vision model and the course material linked to the problem. A "solved document" for a
  whole assignment is just every per-problem solution stitched together, generated in parallel.
- **Grading** sends the uploaded images (or PDF) plus each problem's statement, its official solution (or AI solution)
  and its linked sections as keys. It returns per-problem score, verdict, transcription of what was read, feedback,
  mistakes and sections to review. Points default to 10 when the document gives none. Grading never downgrades a problem
  already marked solved.
- **Reading progress**: a section counts as read when its last page has been at least 45% on screen for 4 seconds, or
  when marked manually. Earlier versions marked whole sections read from a glance at their first page.

### Agents

- **Never trust URLs written by a model.** The first agent version asked Gemini (with search) for URLs directly, and
  several were plausible but fake. The current flow: the model writes search queries (guided by the skill file), Google
  Search runs through Gemini grounding, the grounding redirect links are resolved to real URLs, those pages are opened
  and their PDF/video links collected, and only then does the model choose items, **by key, from that verified
  inventory**.
- If Gemini is unavailable, search falls back to DuckDuckGo's HTML endpoint.
- Solution pairing guards: a solutions URL equal to the problems URL is ignored (the file contains its own solutions),
  and a solutions URL shared by several assignments is treated as a general answer key and dropped. Before this, every
  Stat 110 set was paired with a whole textbook's answer key.
- The skill files in `skills/` are the agents' policy (which sources rank highest, what counts as practice). Edit them
  to change agent behaviour without touching code.

### OpenCourseWare importer

- Course pages are crawled breadth-first (up to 300 pages). OCW "SC" (scholar) courses nest pages several levels deep
  with dots in the path (`pages/1.-differentiation/part-a-.../session-1-.../`); the first crawler only matched one path
  segment and found 7 pages of 18.01SC instead of 135.
- Resource links are rewritten to `[R:slug]` markers so the model can refer to them exactly. Small sites are organised
  in a single call; sites with more than 40 pages are organised in batches of 20 pages, each session page becoming a
  unit in discovery order. A single call over 548 resources took over 10 minutes.
- Resource slug `x_pdf` usually maps to `<course>/x.pdf`, which is checked with a HEAD request before falling back to
  scraping the resource page. Video resource pages also link a transcript PDF, so videos are resolved as videos first.

### AI providers and failure handling

- `ai.ts` wraps everything: `gemini()`, `geminiJSON()` (JSON with retries and repair) and `generateText()`.
- On a 401/402/403, Gemini is marked unavailable for 10 minutes and every call falls back to DeepSeek; DeepSeek is
  marked unavailable for 5 minutes on 401/402. The server probes both at startup and every 10 minutes, and
  `/api/status` drives the in-app notice.
- DeepSeek cannot read PDFs or videos, so callers pass `fallbackText` (the extracted page text) for PDF analysis. Video
  chaptering has no fallback: without Gemini a video becomes a single section, summarised from its title.
- Gemini sometimes accepted requests intermittently while reporting 402 elsewhere, so some calls during the outage still
  succeeded. Do not assume all-or-nothing.
- Imports go through a concurrency limiter (separate limits for Gemini and DeepSeek) and interactive calls (hints,
  grading) use their own limiter so a big import does not block a learner.

### Jobs and restarts

- Jobs run in-process and write progress to the `jobs` table every ~400 ms. If the server stops, jobs die with it.
- On startup, the server resumes interrupted work: courses still `importing`/`linking` rerun the full pipeline
  (remaining documents, linking, overview) and stray single materials are reprocessed. It skips this if another
  process (such as a CLI import) has updated a job in the last 5 minutes, so the two do not fight over the same rows.
- Starting the server marks jobs older than 5 minutes as `interrupted`. An earlier version marked every running job,
  which made a concurrent CLI import think it had finished and exit.

### Frontend

- React + Vite, no UI library. All styling is in `web/src/styles.css`, following BulletApply's "Speed bars" system:
  Sora, Midnight `#0B1B3F` and Electric Blue `#0066FF` (lifted to `#3385FF` in dark mode), mist fills instead of borders
  and shadows, colour only for state, the six-bar meter for progress, and a sparkle glyph (never violet) for AI features.
  Light and dark follow the OS.
- **PDF rendering** (pdf.js 4.10): each page renders lazily into a fresh canvas that is swapped in when complete. Reusing
  one canvas left half-drawn pages when a resize re-rendered while a previous render was still cancelling.
- **Viewer width** is measured with ResizeObserver plus a window resize listener plus a 1-second backstop. ResizeObserver
  callbacks pause in hidden or background tabs, which left pages sized for a stale width. Pages are centred with
  `align-items: safe center` so overflow can never clip the left-hand markers.
- Markers on the same page are nudged apart so they never overlap. Hover cards stay open while the pointer moves into
  them (short close delay).
- KaTeX renders hidden MathML with absolute positioning; without `position: relative` on `.md` and `.main`, those
  elements stretched the document to 28,000 px and produced a second scrollbar.
- Web pages imported as material are sanitised server-side with a cheerio tag/attribute allow-list and rendered with
  `dangerouslySetInnerHTML`. Fine for a local single-user app; revisit before any multi-user deployment.

### Running inside the Claude desktop app

The desktop app stops preview servers it started when an agent turn ends. During the build this paused an import
for over an hour. The fix was to run the server as a detached process (`Start-Process node ...` on Windows) and point
the preview at the running URL. Outside that environment, just run `npm run server` normally.

## 6. Known issues and limitations

- No authentication and a single learner per database. Progress, hints revealed and uploads are global.
- No migrations (see the data model).
- Without Gemini: PDFs are read from extracted text (math is garbled compared with Gemini's visual reading), videos get
  no chapters, and agent search uses DuckDuckGo.
- Grading a PDF of handwriting needs Gemini; the DeepSeek fallback can grade photos and typed PDFs only.
- Large OCW scholar courses produce many small "Clip" videos. Fine for navigation, noisy in the learning path.
- Video chapters occasionally come back slightly out of order; they are not sorted or validated.
- The AI course overview for 18.01SC is missing because credits ran out mid-import. Rerun `buildOverview` (exported
  from `server/ingest.ts`) once AI is back.
- One 18.01SC solution document failed to process. Retry it with Reprocess in the material panel.
- No automated tests. Everything was verified by hand in the browser and through the API.

## 7. Next steps

Roughly in priority order:

1. **Top up a provider** (Gemini preferred), then rebuild the 18.01SC overview and retry its failed solution document.
2. **Project codebases as Apply material** (asked for in the original brief, not built): accept a GitHub URL or zip,
   turn the README and issues into tasks, link tasks to sections, and grade by reviewing code instead of handwriting.
3. **Textbook exercises as practice**: textbooks contain both Source and Apply. Split a textbook's "Exercises"
   sections into problems (with the book's answer key when there is one) instead of treating them only as reading.
4. **Tests**: unit tests for `parseJSON` repair, anchor `locate()`, solution label matching and the OCW page regex
   (all have regressed at least once), plus an API smoke test with mocked providers (fake keys only).
5. **Migrations**: a small numbered-migration runner in `db.ts`.
6. **Accounts** if this becomes multi-user: per-user progress, hints and submissions, and real HTML sanitisation.
7. **Spaced review**: use grades and "sections to review" from grading to schedule revisits and surface weak concepts
   on the course page.
8. **Notes**: per-section text notes (uploads of notes already work as Source material).
9. **Cost controls**: per-import token estimates and a confirmation before importing very large courses.

## 8. Useful commands

```bash
# Is AI available?
curl -s localhost:5174/api/status

# What is running?
curl -s localhost:5174/api/jobs

# Inspect the database (Node has SQLite built in)
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/ile.db');console.log(d.prepare('select id,title,status from courses').all())"
```

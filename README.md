# ILE: Integrated Learning Environment

> Picking this project up? Start with [HANDOFF.md](HANDOFF.md): build and run, current state, design decisions and next steps.

A local, AI-powered hub for learning a subject. Drop in textbooks, lecture notes, YouTube lectures, web pages
or a whole MIT OpenCourseWare course, and ILE reads them, splits them into **Source** (material that teaches)
and **Apply** (material to practise on: problem sets, in-class problems, exams), and links the two both ways.

- **Reading** a PDF, every section has a margin marker. Hover it to see a card with the practice problems that use it.
- **Solving** a problem, hover its marker (or open it) to see the sections that teach what it needs.
- **Hints** work like LeetCode: Hint 1, Hint 2, ... up to 5, each more specific, none giving away the answer.
- **Solutions**: official solutions are matched to each problem and linked to the right page of the solutions PDF.
  When an assignment has none, ILE writes a solved document from the course material covered up to that point.
- **Your work**: upload photos or a PDF of handwritten work, for one problem or a whole assignment, and press
  **AI grade this**. A vision model reads the handwriting, equations and diagrams and returns a score, per-problem
  feedback, the mistakes it found, and links to the sections worth reviewing.
- **Progress**: sections are marked read as you finish them, problems carry a status (not started, attempted, solved),
  and the course page tracks material read, problems solved and your average grade.
- **Agents**: "New course, Learn something new" researches the best free material for a goal (open university courses
  first, then open textbooks, notes, lecture series; guided by `skills/curate-course.md`), verifies every link and builds
  the course. "Find more practice" does the same for problem sets and exams (`skills/find-practice.md`).
- **Knowledge web**: a map of every Source section and Apply problem with the links between them.

## Running it

Requires Node 22.18+ (developed on Node 26, which runs the TypeScript server directly).

```bash
npm install
cp .env.example .env   # add your keys
npm start              # builds the web app, then serves everything on :5174
```

Then open http://localhost:5174. On Windows you can also double-click `start.cmd`. Server output goes to the console
(or to `data/server.log` when started in the background). API keys live in `ile/.env` (see `.env.example`): `GEMINI_API_KEY` is required;
`DEEPSEEK_API_KEY` is a text fallback. Models: `GEMINI_MODEL` (default `gemini-3.8-flash`) for reading, linking and
hints, `GEMINI_VISION_MODEL` (default `gemini-pro-latest`) for worked solutions and grading.

**If both providers are out of credit**, reading, the linked hover cards, official solutions, saved hints and uploads keep
working, and every AI button explains that credit is needed. The server re-checks both providers every 10 minutes, so AI
comes back on its own after a top-up.

**If Gemini is unavailable** (for example its prepaid credits run out, HTTP 402), ILE switches to DeepSeek for
10 minutes at a time and shows a notice in the corner. On DeepSeek: hints, worked solutions, linking and grading of
photos all work (DeepSeek reads images); PDFs are read from their extracted text instead of visually; web search for
the agents falls back to DuckDuckGo; YouTube videos are added as a single section because only Gemini can watch them.
Top up Gemini credits at https://ai.studio/projects to get the full experience back. Nothing needs restarting.

For frontend development with hot reload, run the server as above and `npx vite` in another terminal (port 5173,
proxying `/api` to 5174).

## Importing a course from the command line

```bash
node --env-file=.env scripts/import-ocw.ts https://ocw.mit.edu/courses/18-05-introduction-to-probability-and-statistics-spring-2022/
```

`--resume <courseId>` finishes an interrupted import. `scripts/rematch-solutions.ts <courseId>` re-runs solution
matching for assignments whose problems are missing official solutions.

## How it works

| Piece | File |
|---|---|
| Database (SQLite, `data/ile.db`) | `server/db.ts` |
| Gemini / DeepSeek clients, JSON repair for LaTeX | `server/ai.ts` |
| PDF text with line positions, anchor lookup | `server/pdf.ts` |
| Prompts that turn a document into sections / problems / solutions | `server/analyze.ts` |
| Ingestion, Source-Apply linking, course overview | `server/ingest.ts` |
| Hints, AI solutions, AI grading | `server/tutor.ts` |
| Research agents | `server/agent.ts`, `skills/*.md` |
| Importers: MIT OCW, web pages, YouTube videos/playlists | `server/importers/` |
| API routes | `server/index.ts` |
| Frontend (React) | `web/src/` |

Each PDF is sent to Gemini, which returns its sections (or problems) with a verbatim anchor phrase. The anchor is found
in the PDF's text layer to place the margin marker at the right height. Problems are linked to sections in one call per
assignment, using a catalog of every section's concepts, preferring material taught at or before that unit.
Videos are chaptered by Gemini directly from the YouTube URL.

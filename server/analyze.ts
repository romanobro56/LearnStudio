// "Understanding" a document: turn a PDF / video / page into sections (source) or problems (apply).
import { geminiJSON, type Part } from './ai.ts';

export interface SectionOut { title: string; page?: number; endPage?: number; anchor?: string; summary: string; concepts: string[]; tStart?: number; tEnd?: number }
export interface ProblemOut { label: string; number?: string; title?: string; page?: number; anchor?: string; statement: string; topics: string[]; points?: number; answer?: string }
export interface SolutionOut { label: string; page?: number; anchor?: string; solution: string; answer?: string }

const MATH = 'Write all mathematics in LaTeX using $...$ for inline and $$...$$ for display math. Use Markdown for structure (lists, bold, tables). Do not wrap the JSON in code fences.';

export async function analyzeSource(doc: Part, ctx: { title: string; course: string; pages?: number; isVideo?: boolean; text?: string }) {
  const where = ctx.isVideo
    ? 'This is a lecture video. Use tStart / tEnd in seconds from the start of the video for each section (chapter). Anchor can be empty.'
    : `The document has ${ctx.pages ?? 'several'} pages. "page" is the 1-based page where the section starts. "anchor" must be copied verbatim from the document: the section heading, or the first 6 to 10 words of the section exactly as printed, so we can find it in the PDF text layer.`;
  return geminiJSON<{ summary: string; keyConcepts: string[]; sections: SectionOut[] }>({
    system: `You index study material for an integrated learning environment. You read carefully and never invent content that is not in the material.`,
    parts: [
      doc,
      {
        text: `Course: ${ctx.course}\nMaterial: ${ctx.title}\n\nSplit this material into its logical sections, the way a student would navigate it: follow the document's own headings where it has them (e.g. "3 Conditional probability", "3.2 The multiplication rule"), merging tiny subsections and splitting very long ones so each section teaches one idea. Typically 3-12 sections for a 10 page reading, more for long documents. Skip front and back matter (title page, copyright, table of contents, preface, index, bibliography). For slides, group consecutive slides on one topic.\n${where}\n\nReturn JSON:\n{"summary": "2-3 sentence overview of the whole material", "keyConcepts": ["..."], "sections": [{"title": "...", "page": 1, "endPage": 2, "anchor": "...", "tStart": 0, "tEnd": 0, "summary": "1-2 sentences on what this section teaches", "concepts": ["3-7 precise concept names, e.g. 'Bayes theorem', 'law of total probability'"]}]}\n${MATH}`,
      },
    ],
    thinking: 'low',
    fallbackText: ctx.text,
    lowMedia: ctx.isVideo,
  });
}

export async function analyzeApply(doc: Part, ctx: { title: string; course: string; pages?: number; text?: string }) {
  return geminiJSON<{ summary: string; hasSolutions: boolean; problems: ProblemOut[] }>({
    system: `You transcribe problem sets and exams exactly for an integrated learning environment. You never skip a problem and never invent content.`,
    parts: [
      doc,
      {
        text: `Course: ${ctx.course}\nMaterial: ${ctx.title} (${ctx.pages ?? '?'} pages)\n\nList every top-level problem / question / exercise in this document in order. Keep sub-parts (a), (b), ... inside their parent problem's statement. For concept questions or multiple-choice board questions, each one is a problem.\n\nFor each problem return:\n- "label": how the document names it, e.g. "Problem 3", "Question 2", "Concept question 1"\n- "number": its number as a string, e.g. "3"\n- "title": a 2-6 word description of what it is about (use the document's own title in parentheses if present)\n- "page": 1-based page where it starts\n- "anchor": the first 6-10 words of the problem exactly as printed (verbatim, including the label), so we can find it in the PDF text layer\n- "statement": the complete problem statement transcribed faithfully into Markdown, with every sub-part, data table and given value. Describe figures in [brackets] if needed.\n- "topics": 2-6 concepts the problem exercises\n- "points": total points if stated, else null\n- "answer": if this document also contains the solution or answer, a short final answer; otherwise null\n\nAlso return "summary" (one sentence) and "hasSolutions" (true if this document contains worked solutions, not just problems).\nReturn JSON: {"summary": "...", "hasSolutions": false, "problems": [...]}\n${MATH}`,
      },
    ],
    thinking: 'low',
    fallbackText: ctx.text,
    maxTokens: 60000,
  });
}

export async function analyzeSolutions(doc: Part, ctx: { title: string; course: string; problems: { label: string; statement: string }[]; text?: string }) {
  const list = ctx.problems.map((p) => `- label "${p.label}" (begins: ${p.statement.slice(0, 120).replace(/\s+/g, ' ')})`).join('\n');
  return geminiJSON<{ solutions: SolutionOut[] }>({
    system: `You transcribe worked solutions exactly for an integrated learning environment. You never invent steps that are not in the document.`,
    parts: [
      doc,
      {
        text: `Course: ${ctx.course}\nThis document is "${ctx.title}", the official solutions. These are the problems it solves:\n${list}\n\nFor each problem above, find its solution in the document and return:\n- "label": exactly the quoted label from the list above and nothing else (e.g. "Problem 2")\n- "page": 1-based page where the solution starts\n- "anchor": first 6-10 words of that solution (or of the restated problem heading) exactly as printed\n- "solution": the full worked solution transcribed faithfully into Markdown, all parts, keeping the reasoning\n- "answer": a one-line final answer summary\nSkip a problem only if it truly has no solution in the document.\nReturn JSON: {"solutions": [...]}\n${MATH}`,
      },
    ],
    thinking: 'low',
    fallbackText: ctx.text,
    maxTokens: 60000,
  });
}

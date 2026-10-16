// AI provider clients. Keys are read from the environment only and never logged.
import fs from 'node:fs';
import path from 'node:path';

const DEBUG = path.resolve(import.meta.dirname, '..', 'data', 'debug');

const GEMINI = 'https://generativelanguage.googleapis.com';
export const MODELS = {
  fast: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  vision: process.env.GEMINI_VISION_MODEL || 'gemini-pro-latest',
  deepseek: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
};

export type Part =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { file_uri: string; mime_type?: string }; video_metadata?: { fps?: number } };

// Simple semaphore so a big import doesn't flood the API.
class Limiter {
  active = 0;
  q: (() => void)[] = [];
  max: number;
  constructor(max: number) { this.max = max; }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.q.push(r));
    this.active++;
    try { return await fn(); } finally {
      this.active--;
      this.q.shift()?.();
    }
  }
}
const limiter = new Limiter(Number(process.env.AI_CONCURRENCY || 6));
// Interactive requests (hints, grading) skip the import queue.
const interactive = new Limiter(8);
const deepseekBulk = new Limiter(Number(process.env.DEEPSEEK_CONCURRENCY || 12));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GenOpts {
  model?: string;
  system?: string;
  parts: Part[];
  json?: boolean;
  temperature?: number;
  thinking?: 'low' | 'high';
  search?: boolean;
  priority?: boolean;
  maxTokens?: number;
  lowMedia?: boolean;
  retries?: number;
  // Text to send instead of PDF / video parts when falling back to a provider that cannot read them.
  fallbackText?: string;
  noFallback?: boolean;
}

// When Gemini reports a billing / auth problem, stop calling it for a while and use DeepSeek instead.
let geminiDown: { until: number; reason: string } | null = null;
let deepseekDown: { until: number; reason: string } | null = null;
export function aiStatus() {
  const down = geminiDown && geminiDown.until > Date.now() ? geminiDown.reason : null;
  const dsDown = deepseekDown && deepseekDown.until > Date.now() ? deepseekDown.reason : null;
  return { gemini: down ? 'unavailable' : 'ok', reason: down, deepseek: dsDown ? 'unavailable' : 'ok', deepseekReason: dsDown, fallback: !!process.env.DEEPSEEK_API_KEY && !dsDown };
}

// A user-facing explanation when an AI call fails for billing reasons.
export function friendlyAiError(msg: string): string {
  if (/402|Insufficient Balance|credits are depleted|RESOURCE_EXHAUSTED/i.test(msg)) {
    return 'AI is unavailable right now: the Gemini and DeepSeek accounts are out of credit. Top up Gemini at ai.studio/projects or DeepSeek at platform.deepseek.com, then try again (no restart needed).';
  }
  return msg;
}

export async function gemini(o: GenOpts): Promise<{ text: string; grounding?: any; finish?: string }> {
  const model = o.model || MODELS.fast;
  const body: any = {
    contents: [{ role: 'user', parts: o.parts }],
    generationConfig: {
      ...(o.json ? { responseMimeType: 'application/json' } : {}),
      ...(o.temperature != null ? { temperature: o.temperature } : {}),
      ...(o.thinking ? { thinkingConfig: { thinkingLevel: o.thinking } } : {}),
      ...(o.maxTokens ? { maxOutputTokens: o.maxTokens } : {}),
      ...(o.lowMedia ? { mediaResolution: 'MEDIA_RESOLUTION_LOW' } : {}),
    },
  };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  if (o.search) body.tools = [{ google_search: {} }];
  if (geminiDown && geminiDown.until > Date.now()) throw new Error('Gemini unavailable: ' + geminiDown.reason);
  const lim = o.priority ? interactive : limiter;
  return lim.run(async () => {
    let lastErr: any;
    for (let attempt = 0; attempt < (o.retries ?? 6); attempt++) {
      try {
        const r = await fetch(`${GEMINI}/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY || '' },
          body: JSON.stringify({ ...body, __restated: undefined }),
          signal: AbortSignal.timeout(300_000),
        });
        if (r.status === 429 || r.status >= 500) {
          lastErr = new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
          await sleep(2000 * 2 ** attempt + Math.random() * 1000);
          continue;
        }
        const j: any = await r.json();
        if (!r.ok) {
          if ([401, 402, 403].includes(r.status)) geminiDown = { until: Date.now() + 10 * 60_000, reason: `${r.status}: ${String(j?.error?.message || '').slice(0, 160)}` };
          throw new Error(`Gemini ${r.status}: ${j?.error?.message || 'error'}`);
        }
        const cand = j.candidates?.[0];
        const text = (cand?.content?.parts || []).filter((p: any) => !p.thought && p.text).map((p: any) => p.text).join('');
        if (!text) {
          lastErr = new Error(`Gemini returned no text (${cand?.finishReason || j.promptFeedback?.blockReason || 'unknown'})`);
          // The recitation filter blocks long verbatim quotes; ask for a faithful restatement instead.
          if (cand?.finishReason === 'RECITATION' && !body.__restated) {
            body.__restated = true;
            const parts = body.contents[0].parts;
            parts.push({ text: 'Important: do not copy long passages verbatim. Restate the text in your own words while keeping every mathematical expression, number and result exactly.' });
          }
          await sleep(1500);
          continue;
        }
        return { text, grounding: cand?.groundingMetadata, finish: cand?.finishReason };
      } catch (e: any) {
        lastErr = e;
        if (String(e.message).startsWith('Gemini 4')) throw e;
        await sleep(2000 * 2 ** attempt);
      }
    }
    throw lastErr;
  });
}

export async function geminiJSON<T = any>(o: GenOpts): Promise<T> {
  try {
    return await geminiJSONOnly<T>(o);
  } catch (e: any) {
    if (o.noFallback || o.search || !process.env.DEEPSEEK_API_KEY) throw e;
    console.warn('[ai] Gemini failed, using DeepSeek:', String(e.message).slice(0, 120));
    for (let i = 0; i < 2; i++) {
      const v = parseJSON(await deepseekParts(o, true));
      if (v !== undefined) return v as T;
    }
    throw e;
  }
}

async function geminiJSONOnly<T = any>(o: GenOpts): Promise<T> {
  let last = '';
  for (let i = 0; i < 3; i++) {
    const { text, finish } = await gemini({ ...o, json: true });
    const v = parseJSON(text);
    if (v !== undefined) return v as T;
    last = text;
    try {
      fs.mkdirSync(DEBUG, { recursive: true });
      fs.writeFileSync(`${DEBUG}/json-${Date.now()}.txt`, `finish=${finish}\n${text}`);
    } catch {}
  }
  throw new Error('Model did not return valid JSON (' + last.length + ' chars)');
}

export function parseJSON(text: string): any {
  const v = parseRaw(text);
  return v === undefined ? undefined : fixLatex(v);
}

function parseRaw(text: string): any {
  let t = text.trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fence) {
    t = fence[1].trim();
    try { return JSON.parse(t); } catch {}
  }
  const s = Math.min(...['{', '['].map((c) => t.indexOf(c)).filter((i) => i >= 0));
  const e = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (isFinite(s) && e > s) t = t.slice(s, e + 1);
  try { return JSON.parse(t); } catch {}
  try { return JSON.parse(repairEscapes(t)); } catch {}
  return undefined;
}

// Models sometimes write LaTeX backslashes unescaped inside JSON strings ("\{", "\sum").
function repairEscapes(t: string): string {
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c !== '\\') { out += c; continue; }
    const n = t[i + 1];
    const word = t.slice(i + 1).match(/^[a-zA-Z]+/)?.[0] || '';
    if (n === 'u' && /^u[0-9a-fA-F]{4}/.test(t.slice(i + 1, i + 6))) { out += c + n; i++; }
    // A stray backslash right before the closing quote of a value: `... & \", "page": 3`
    else if (n === '"' && /^"\s*(,\s*"[\w-]+"\s*:|[}\]])/.test(t.slice(i + 1))) { out += '\\\\'; }
    else if ('"\\/'.includes(n)) { out += c + n; i++; }
    else if ('bfnrt'.includes(n) && !(word.length > 1 && LATEX.test(word))) { out += c + n; i++; }
    else out += '\\\\';
  }
  return out;
}

const LATEX = /^(frac|beta|bar|binom|big|bigg|boxed|neq|nu|nabla|not|notin|newline|ne|theta|tau|times|text|textbf|tilde|to|top|triangle|right|rho|rangle|rm|rfloor|rceil|bullet|forall|for|binom|tfrac|dfrac|backslash|bmod)/;

// Undo LaTeX commands that JSON silently turned into control characters (\frac -> form feed + "rac").
function fixLatex(v: any): any {
  if (typeof v === 'string') {
    return v
      .replace(/\f/g, '\\f')
      .replace(/\x08/g, '\\b')
      .replace(/\t(?=(imes|heta|au|ext|ilde|o\b|op|riangle|frac|extbf)[^a-z]?)/g, '\\t')
      .replace(/\r(?=(ho|ight|angle|m\b|floor|ceil))/g, '\\r')
      .replace(/\n(?=(eq|u\b|abla|ot|otin|ewline|e\b|eg\b|exists))/g, '\\n');
  }
  if (Array.isArray(v)) return v.map(fixLatex);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fixLatex(x)]));
  return v;
}

// DeepSeek: text-only fallback / second opinion.
export async function deepseek(system: string, user: string, json = false): Promise<string> {
  return interactive.run(async () => {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (process.env.DEEPSEEK_API_KEY || '') },
      body: JSON.stringify({
        model: MODELS.deepseek,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(300_000),
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${j?.error?.message || 'error'}`);
    return j.choices?.[0]?.message?.content || '';
  });
}

// DeepSeek with Gemini-style parts: text and images pass through; PDFs / videos become fallbackText.
export async function deepseekParts(o: GenOpts, json = false): Promise<string> {
  if (deepseekDown && deepseekDown.until > Date.now()) throw new Error('DeepSeek 402: ' + deepseekDown.reason);
  const content: any[] = [];
  let missing = false;
  for (const p of o.parts) {
    if ('text' in p) content.push({ type: 'text', text: p.text });
    else if ('inline_data' in p && p.inline_data.mime_type.startsWith('image/')) content.push({ type: 'image_url', image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` } });
    else missing = true;
  }
  if (missing) {
    if (!o.fallbackText) throw new Error('This step needs Gemini (it reads PDFs or videos directly), and Gemini is unavailable.');
    content.unshift({ type: 'text', text: 'DOCUMENT TEXT (extracted from the PDF, page markers in brackets):\n' + o.fallbackText.slice(0, 400_000) });
  }
  return (o.priority ? interactive : deepseekBulk).run(async () => {
    let lastErr: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (process.env.DEEPSEEK_API_KEY || '') },
          body: JSON.stringify({
            model: MODELS.deepseek,
            messages: [...(o.system ? [{ role: 'system', content: o.system }] : []), { role: 'user', content: content.length === 1 && content[0].type === 'text' ? content[0].text : content }],
            ...(json ? { response_format: { type: 'json_object' } } : {}),
            ...(o.maxTokens ? { max_tokens: Math.min(o.maxTokens, 64000) } : {}),
          }),
          signal: AbortSignal.timeout(600_000),
        });
        const j: any = await r.json();
        if (r.status === 429 || r.status >= 500) { lastErr = new Error(`DeepSeek ${r.status}`); await sleep(3000 * (attempt + 1)); continue; }
        if (!r.ok) {
          if ([401, 402].includes(r.status)) deepseekDown = { until: Date.now() + 5 * 60_000, reason: `${r.status}: ${String(j?.error?.message || '').slice(0, 120)}` };
          throw new Error(`DeepSeek ${r.status}: ${j?.error?.message || 'error'}`);
        }
        return j.choices?.[0]?.message?.content || '';
      } catch (e: any) {
        lastErr = e;
        if (String(e.message).startsWith('DeepSeek 4')) throw e;
        await sleep(3000);
      }
    }
    throw lastErr;
  });
}

// Text generation with automatic fallback to DeepSeek when Gemini fails.
export async function generateText(system: string, parts: Part[], opts: Partial<GenOpts> = {}): Promise<string> {
  try {
    return (await gemini({ system, parts, ...opts })).text;
  } catch (e) {
    console.warn('[ai] Gemini failed, falling back to DeepSeek:', (e as Error).message.slice(0, 120));
    return deepseekParts({ system, parts, ...opts });
  }
}

export function pdfPart(file: string): Part {
  return { inline_data: { mime_type: 'application/pdf', data: fs.readFileSync(file).toString('base64') } };
}
export function imagePart(file: string, mime: string): Part {
  return { inline_data: { mime_type: mime, data: fs.readFileSync(file).toString('base64') } };
}

// Files API for documents too large to inline (> ~15 MB).
export async function uploadFile(file: string, mime: string, name: string): Promise<Part> {
  const size = fs.statSync(file).size;
  const start = await fetch(`${GEMINI}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': process.env.GEMINI_API_KEY || '',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mime,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: name.slice(0, 100) } }),
  });
  const url = start.headers.get('x-goog-upload-url');
  if (!url) throw new Error('File upload could not start');
  const up = await fetch(url, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', 'content-length': String(size) },
    body: fs.readFileSync(file),
  });
  let info: any = (await up.json()).file;
  for (let i = 0; i < 60 && info?.state === 'PROCESSING'; i++) {
    await sleep(3000);
    const r = await fetch(`${GEMINI}/v1beta/${info.name}`, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY || '' } });
    info = await r.json();
  }
  if (info?.state !== 'ACTIVE') throw new Error('Uploaded file did not become active');
  return { file_data: { file_uri: info.uri, mime_type: mime } };
}

export async function docPart(file: string, mime = 'application/pdf', name = 'document'): Promise<Part> {
  const size = fs.statSync(file).size;
  if (size < 14 * 1024 * 1024) return { inline_data: { mime_type: mime, data: fs.readFileSync(file).toString('base64') } };
  return uploadFile(file, mime, name);
}

// Cheap check at startup so the UI can say which AI providers are usable before anything fails.
export async function probeAi() {
  await gemini({ parts: [{ text: 'Reply with OK.' }], retries: 1, maxTokens: 5, priority: true }).catch(() => {});
  if (process.env.DEEPSEEK_API_KEY) await deepseekParts({ parts: [{ text: 'Reply with OK.' }], maxTokens: 5, priority: true }).catch(() => {});
}

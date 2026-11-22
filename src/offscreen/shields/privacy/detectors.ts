import { PRIORITY, type Span } from './spans';
import type { EntityType } from '../../../types/shield';

/** Deterministic detectors: used alone when no NER model is installed, and always alongside it. */

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const add = (out: Span[], m: RegExpMatchArray, type: EntityType, priority: number, group = 0): void => {
  const text = m[group];
  if (text === undefined || m.index === undefined) return;
  const offset = group === 0 ? 0 : m[0].indexOf(text);
  const start = m.index + offset;
  out.push({ start, end: start + text.length, type, priority, confidence: 1 });
};

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
];
const SECRET_ASSIGN = /\b(?:password|passwd|pwd|passcode|secret|token|api[_-]?key|access[_-]?key)\b\s*(?:is|[:=])\s*["']?([^\s"',;]{4,})/gi;

/** Capitalized words that start sentences or name things but are not part of a person's name. */
const NOT_NAME = new Set(
  ('the a an and or but if so to of in on at for with from by as is are was were be been i me my we our you your he she it they them his her their this that these those ' +
    'hello hi hey dear thanks thank please regards sincerely best cheers yes no ok okay what when where why who how which ' +
    'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december ' +
    'mr mrs ms miss dr prof sir madam email phone address name contact call text send write tell ask help can could would should will do does did ' +
    'new old north south east west united states kingdom india china japan europe asia africa america google microsoft apple amazon openai chatgpt claude gemini copilot').split(' '),
);

/** Runs of 2-3 capitalized words ("John Doe", "Aarav Sharma"), trimmed of greetings/stopwords at the edges. */
function detectFullNames(text: string, out: Span[]): void {
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])\p{Lu}[\p{Ll}'’-]+(?:[ ]\p{Lu}[\p{Ll}'’-]+){1,3}(?![\p{L}\p{N}])/gu)) {
    const words = [...m[0].matchAll(/\S+/g)].map((w) => ({ w: w[0], at: w.index ?? 0 }));
    let lo = 0;
    let hi = words.length;
    while (lo < hi && NOT_NAME.has(words[lo]!.w.toLowerCase())) lo++;
    while (hi > lo && NOT_NAME.has(words[hi - 1]!.w.toLowerCase())) hi--;
    if (hi - lo < 2 || hi - lo > 3) continue;
    if (words.slice(lo, hi).some((x) => NOT_NAME.has(x.w.toLowerCase()))) continue;
    const start = (m.index ?? 0) + words[lo]!.at;
    const last = words[hi - 1]!;
    out.push({ start, end: (m.index ?? 0) + last.at + last.w.length, type: 'PERSON', priority: PRIORITY.HEURISTIC, confidence: 0.7 });
  }
}

export function detectDeterministic(text: string): Span[] {
  const out: Span[] = [];

  for (const re of SECRET_PATTERNS) for (const m of text.matchAll(re)) add(out, m, 'SECRET', PRIORITY.SECRET);
  for (const m of text.matchAll(SECRET_ASSIGN)) add(out, m, 'SECRET', PRIORITY.SECRET, 1);

  for (const m of text.matchAll(/\b\d{3}-\d{2}-\d{4}\b/g)) add(out, m, 'ID', PRIORITY.ID);
  for (const m of text.matchAll(/(?<![\d][ -]?)\b\d{4}\s\d{4}\s\d{4}\b(?![ -]?\d)/g)) add(out, m, 'ID', PRIORITY.ID); // Aadhaar-style
  for (const m of text.matchAll(/\b[A-Z]{5}\d{4}[A-Z]\b/g)) add(out, m, 'ID', PRIORITY.ID); // PAN-style
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g)) {
    if (m[0].replace(/\s/g, '').length >= 15) add(out, m, 'ID', PRIORITY.ID); // IBAN
  }
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) add(out, m, 'ID', PRIORITY.ID);
  }

  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) add(out, m, 'EMAIL', PRIORITY.EMAIL);

  for (const m of text.matchAll(/(?<![\w.])\+?\d[\d\s().-]{8,18}\d(?![\w])/g)) {
    const digits = m[0].replace(/\D/g, '').length;
    if (digits >= 10 && digits <= 15 && /[\s().+-]/.test(m[0])) add(out, m, 'PHONE', PRIORITY.PHONE);
  }

  for (const m of text.matchAll(/(?<![\w.])(?:\+?91[\s-]?)?[6-9]\d{9}(?![\w])/g)) add(out, m, 'PHONE', PRIORITY.PHONE); // Indian mobile
  for (const m of text.matchAll(/(?<![\w.])[2-9]\d{11}(?![\w])/g)) add(out, m, 'ID', PRIORITY.ID); // Aadhaar without spaces

  // PERSON heuristics: introductions and titles. The trigger is matched case-insensitively,
  // the name itself case-sensitively (a sticky regex at the trigger's end).
  const NAME = /[A-Z][a-z]+(?:[ ](?:[A-Z][a-z]+|[A-Z]\.)){0,2}/y;
  for (const m of text.matchAll(/\b(?:my name is|i am|i'm|this is|name:|signed,?|regards,?|dear)\s+/gi)) {
    NAME.lastIndex = (m.index ?? 0) + m[0].length;
    const n = NAME.exec(text);
    if (n) out.push({ start: n.index, end: n.index + n[0].length, type: 'PERSON', priority: PRIORITY.HEURISTIC, confidence: 1 });
  }
  for (const m of text.matchAll(/\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+([A-Z][a-z]+(?:[ ][A-Z][a-z]+)?)/g)) add(out, m, 'PERSON', PRIORITY.HEURISTIC, 1);

  detectFullNames(text, out);

  // ORG
  for (const m of text.matchAll(/\b(?:[A-Z][\w&'-]*\s){1,3}(?:Inc|LLC|Ltd|Corp|Corporation|Company|GmbH|Technologies|Labs|University|Institute|Bank|Hospital)\b\.?/g)) {
    add(out, m, 'ORG', PRIORITY.HEURISTIC);
  }

  // LOC: street addresses and "live in X"
  for (const m of text.matchAll(/\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way)\b\.?/g)) {
    add(out, m, 'LOC', PRIORITY.HEURISTIC);
  }
  for (const m of text.matchAll(/\b(?:i live in|living in|based in|located in|i'm from|i am from)\s+([A-Z][a-z]+(?:[ ,]+[A-Z][a-z]+){0,2})/gi)) {
    if (m[1] && /^[A-Z]/.test(m[1])) add(out, m, 'LOC', PRIORITY.HEURISTIC, 1);
  }
  return out;
}

import { describe, expect, it } from 'vitest';
import { redact } from '../src/offscreen/shields/privacyShield';
import { restorePlaceholders } from '../src/offscreen/shields/privacy/swapper';
import { decodeBio } from '../src/offscreen/shields/privacy/ner';
import { WordPieceTokenizer } from '../src/offscreen/shields/privacy/tokenizer';
import { EMPTY_VAULT, addToVault } from '../src/shared/vault';

const run = (text: string, existingMap = {}, vault = EMPTY_VAULT) => redact({ text, existingMap, vault });

describe('privacy shield (deterministic mode)', () => {
  it('redacts emails, phones, SSNs, cards and secrets', async () => {
    const t = 'Mail ada@example.com or call +1 (415) 555-2671. SSN 123-45-6789, card 4111 1111 1111 1111, key sk-abcdefghijklmnopqrstuvwx';
    const { result } = await run(t);
    expect(result.redactedText).not.toMatch(/ada@example|555-2671|123-45-6789|4111|sk-abc/);
    expect(result.redactedText).toContain('[EMAIL_1]');
    expect(result.redactedText).toContain('[SECRET_1]');
    expect(result.count).toBeGreaterThanOrEqual(5);
  });

  it('does not flag Luhn-invalid digit runs or ordinary text', async () => {
    const { result } = await run('Order 1234 5678 9012 3456 shipped on 2024-01-05 for 12 items.');
    expect(result.redactedText).toContain('1234 5678 9012 3456');
  });

  it('swaps names deterministically and reuses placeholders across prompts', async () => {
    const a = await run('My name is Ada Lovelace and I work at Acme Technologies.');
    expect(a.result.redactedText).toContain('[PERSON_1]');
    expect(a.result.redactedText).toContain('[ORG_1]');
    const b = await run('Dear Ada Lovelace, meet Dr. Grace Hopper.', a.result.map);
    expect(b.result.redactedText).toContain('[PERSON_1]'); // same value, same placeholder
    expect(b.result.redactedText).toContain('[PERSON_2]'); // counter continues
  });

  it('restores placeholders in an assistant reply', async () => {
    const a = await run('My name is Ada Lovelace, ada@example.com');
    const reply = 'Hello [PERSON_1], I will write to [EMAIL_1].';
    expect(restorePlaceholders(reply, a.result.map)).toBe('Hello Ada Lovelace, I will write to ada@example.com.');
  });

  it('matches hashed vault keywords without storing plaintext', async () => {
    let vault = await addToVault(EMPTY_VAULT, 'Project Bluebird');
    vault = await addToVault(vault, 'hunter');
    expect(JSON.stringify(vault).toLowerCase()).not.toContain('bluebird');
    const { result } = await run('Status of project bluebird: hunter is ready.', {}, vault);
    expect(result.redactedText).toBe('Status of [CUSTOM_1]: [CUSTOM_2] is ready.');
  });
});

describe('fallback detector coverage (checkpoint 3)', () => {
  const r = async (t: string) => (await run(t)).result.redactedText;
  it('catches bare full names and Indian names', async () => {
    expect(await r('Please email John Doe about the report')).toBe('Please email [PERSON_1] about the report');
    expect(await r('Aarav Sharma lives here')).toBe('[PERSON_1] lives here');
    expect(await r('Hello John Doe, thanks')).toBe('Hello [PERSON_1], thanks');
  });
  it('catches intro phrases, emails, phones, Aadhaar and API keys together', async () => {
    const t = 'I am Priya Nair, priya.nair@example.co.in, 9876543210, Aadhaar 234567890123, key sk-abcdefghijklmnopqrstuvwx';
    const out = await r(t);
    expect(out).not.toMatch(/Priya|Nair|example\.co\.in|9876543210|234567890123|sk-abc/);
    expect(out).toMatch(/\[PERSON_1\].*\[EMAIL_1\].*\[PHONE_1\].*\[ID_1\].*\[SECRET_1\]/);
  });
  it('does not redact ordinary capitalized phrases', async () => {
    expect(await r('The United States and New York are big. On Monday I use Machine Learning.')).toContain('United States');
    expect(await r('What is the capital of India? Tell me.')).toBe('What is the capital of India? Tell me.');
  });
});

describe('NER postprocessing', () => {
  const vocab = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'ada', 'love', '##lace', 'visits', 'paris'].join('\n');
  it('WordPiece tokenizes with offsets', () => {
    const tok = new WordPieceTokenizer(vocab, true);
    const t = tok.tokenize('Ada Lovelace visits Paris');
    expect(t.map((x) => x.id)).toEqual([4, 5, 6, 7, 8]);
    expect(t[2]).toMatchObject({ start: 8, end: 12, wordStart: false });
  });
  it('decodes BIO into merged spans and skips MISC', () => {
    const p = (start: number, end: number, label: string, wordStart = true, prob = 0.95) => ({ start, end, label, prob, wordStart });
    const spans = decodeBio([p(0, 3, 'B-PER'), p(4, 8, 'I-PER'), p(8, 12, 'I-PER', false), p(13, 19, 'O'), p(20, 25, 'B-LOC'), p(26, 30, 'B-MISC')], 0.6);
    expect(spans.map((s) => [s.type, s.start, s.end])).toEqual([['PERSON', 0, 12], ['LOC', 20, 25]]);
  });
});

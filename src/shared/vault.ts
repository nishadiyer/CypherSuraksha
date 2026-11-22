/**
 * Zero-knowledge "Never Share" vault. Only salted SHA-256 digests are persisted;
 * plaintext keywords exist in memory just long enough to be hashed.
 */
export interface Vault {
  salt: string; // base64
  hashes: string[]; // hex
}

const enc = new TextEncoder();

export function normalizeKeyword(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(normalized: string): number {
  return normalized ? normalized.split(' ').length : 0;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashKeyword(saltB64: string, normalized: string): Promise<string> {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const data = enc.encode(normalized);
  const msg = new Uint8Array(salt.length + data.length);
  msg.set(salt, 0);
  msg.set(data, salt.length);
  const digest = toHex(await crypto.subtle.digest('SHA-256', msg));
  msg.fill(0);
  data.fill(0);
  return digest;
}

export function newSalt(): string {
  const s = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  s.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export const EMPTY_VAULT: Vault = { salt: '', hashes: [] };

/** Longest keyword (in words) that is matched; fixed so the stored vault leaks no length metadata. */
const MAX_WORDS = 6;

/** Pure: returns a new vault with the keyword added (hashed). */
export async function addToVault(vault: Vault, keyword: string): Promise<Vault> {
  const norm = normalizeKeyword(keyword);
  if (!norm) return vault;
  const salt = vault.salt || newSalt();
  const h = await hashKeyword(salt, norm);
  if (vault.hashes.includes(h)) return { ...vault, salt };
  return { salt, hashes: [...vault.hashes, h] };
}

export interface VaultMatch {
  start: number;
  end: number;
}

/**
 * Finds spans of `text` whose normalized n-gram hashes equal a stored digest.
 * Windows up to MAX_WORDS words, so matching cost is O(words * MAX_WORDS) digests.
 */
export async function matchVault(text: string, vault: Vault): Promise<VaultMatch[]> {
  if (!vault.hashes.length || !vault.salt) return [];
  const set = new Set(vault.hashes);
  const words = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’._-]*/gu)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  const out: VaultMatch[] = [];
  for (let i = 0; i < words.length; i++) {
    // longest window first so "john smith" wins over "john"
    for (let n = Math.min(MAX_WORDS, words.length - i); n >= 1; n--) {
      const first = words[i]!;
      const last = words[i + n - 1]!;
      if (last.end - first.start > 120) continue;
      const norm = normalizeKeyword(text.slice(first.start, last.end));
      if (wordCount(norm) !== n) continue;
      if (set.has(await hashKeyword(vault.salt, norm))) {
        out.push({ start: first.start, end: last.end });
        i += n - 1;
        break;
      }
    }
  }
  return out;
}

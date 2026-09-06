/**
 * Content-addressed caching primitive: identical (normalized) UGC text always
 * maps to the same translation-cache key, whether computed on the server or
 * in the browser. Runs anywhere WebCrypto exists (Node 19+, all browsers).
 */

const encoder = new TextEncoder();

/** NFC-normalize, collapse whitespace runs, trim. */
export const normalizeUgcText = (text: string): string =>
  text.normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * True when `text` carries actual script content (letters / ideographs) —
 * i.e. not just whitespace, digits, punctuation or symbols. Used as the
 * translatability screen before enqueueing; the *language* itself is decided
 * by the nearcade-ugc-ai Worker, never guessed here (mirrors the Worker's
 * own screen in translate.ts/prefilter.ts).
 */
export const hasScriptContent = (text: string): boolean => /[^\s\d\p{P}\p{S}]/u.test(text);

export const sha256Hex = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const ugcTextHash = async (text: string): Promise<string> =>
  sha256Hex(normalizeUgcText(text));

export const translationCacheKey = (hash: string, lang: string): string => `${hash}:${lang}`;

/**
 * Derive the content hashes for a set of auditable fields. The single
 * derivation point used by registration, backfill, and job dispatch —
 * hashes are never stored, always computed from the normalized source text.
 * Fields that are empty or over the audit cap are skipped entirely.
 */
export const ugcFieldHashes = async (
  fields: Record<string, string | undefined | null>,
  maxTextLength: number
): Promise<Map<string, string>> => {
  const byHash = new Map<string, string>();
  for (const raw of Object.values(fields)) {
    const normalized = raw ? normalizeUgcText(raw) : '';
    if (!normalized || normalized.length > maxTextLength) continue;
    const hash = await ugcTextHash(normalized);
    if (!byHash.has(hash)) byHash.set(hash, normalized);
  }
  return byHash;
};

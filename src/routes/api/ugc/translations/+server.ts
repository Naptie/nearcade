import { error, isHttpError, isRedirect, json, type RequestHandler } from '@sveltejs/kit';
import { m } from '$lib/paraglide/messages';
import { lookupUgcTranslations } from '$lib/ugc/translate.server';
import { enqueueUgcTranslations } from '$lib/ugc/jobs.server';
import { UGC_TRANSLATION_ENABLED } from '$lib/constants';
import type { UgcLocale } from '$lib/ugc/types';
import { ugcTranslationsRequestSchema, ugcTranslationsResponseSchema } from '$lib/schemas/ugc';
import { parseJsonOrError } from '$lib/utils/validation.server';

/**
 * Translation cache endpoint backing the `<T>` renderer and the on-demand
 * job queue.
 *
 * Two behaviors:
 *  1. Cached entries are returned immediately (Redis → Mongo).
 *  2. When the client includes `sources` (hash → source text), missing
 *     hashes are enqueued for background translation so a reader's miss
 *     actually issues the work rather than silently showing the original
 *     forever. The endpoint still returns instantly — clients poll for the
 *     finished translation once the job loop has cached it.
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const { hashes, lang, sources } = await parseJsonOrError(request, ugcTranslationsRequestSchema);

    const found = await lookupUgcTranslations(hashes, lang as UgcLocale);
    const translations: Record<string, string> = {};
    for (const [hash, text] of found) {
      // Empty string = negative cache entry (identity/untranslatable):
      // omit from the response — the client keeps the original text and
      // must NOT wait for a translation that will never come.
      if (text) translations[hash] = text;
    }

    // On-demand backfill: for hashes we couldn't serve (and that are not
    // negatively cached), enqueue translation work if the client provided
    // the source text. Fire-and-forget (never blocks the response); the
    // SSE stream / polling delivers the result.
    // Feature temporarily disabled — cache is still served above (see
    // switch.ts).
    if (sources && UGC_TRANSLATION_ENABLED) {
      const missing = hashes.filter(
        (hash) => !translations[hash] && found.get(hash) !== '' && sources[hash]
      );
      if (missing.length > 0) {
        void enqueueUgcTranslations(
          missing.map((hash) => ({
            hash,
            text: sources[hash],
            target: lang as UgcLocale
          }))
        );
      }
    }

    return json(ugcTranslationsResponseSchema.parse({ translations }));
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading UGC translations:', err);
    error(500, m.internal_server_error());
  }
};

import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import type { Collection } from 'mongodb';
import { normalizeUgcText, translationCacheKey, ugcTextHash } from './hash';
import {
  normalizeUgcTranslationFields,
  UGC_LOCALES,
  type UgcLocale,
  type UgcTranslationField,
  type UgcTranslationMap,
  type UgcTranslationRecord,
  type WithUgcTranslations
} from './types';
import { UGC_TRANSLATION_ENABLED } from '$lib/constants';

/**
 * Translation cache. Content-addressed: `_id = ${sourceHash}:${lang}`.
 * Redis (`nearcade:ugc:t:` keys) is a hot read-through layer; Mongo is the
 * durable store. Readers never wait on inference — misses are enqueued by
 * the on-demand queue (jobs.server.ts) and picked up by polling.
 */

/**
 * Opt-in filter: intersects the requested content types with the signed-in
 * user's auto-translation choices (which share the canonical content-type
 * vocabulary; legacy plural keys are normalized). Signed-out users get an
 * empty list — translation is strictly opt-in.
 */
export const ugcFieldsForUser = <T extends UgcTranslationField>(
  user: { autoTranslation?: { fields: UgcTranslationField[] } } | null | undefined,
  wanted: readonly T[]
): T[] => {
  if (!user?.autoTranslation) return [];
  const optedIn = normalizeUgcTranslationFields(user.autoTranslation.fields);
  return wanted.filter((field) => (optedIn as readonly string[]).includes(field));
};

const TRANSLATIONS_COLLECTION = 'ugc_translations';
const REDIS_KEY_PREFIX = 'nearcade:ugc:t:';
// Content-addressed entries are immutable; TTL is plain garbage collection.
const REDIS_TTL_SECONDS = 60 * 60 * 24 * 30;

const translationsCollection = (): Collection<UgcTranslationRecord> =>
  mongo.db().collection<UgcTranslationRecord>(TRANSLATIONS_COLLECTION);

const redisTranslationKey = (key: string): string => `${REDIS_KEY_PREFIX}${key}`;

/**
 * Single persist point for a finished translation: Mongo (durable) + Redis
 * (hot layer). Used by both the job loop and the backfill script's contract.
 */
export const persistUgcTranslation = async (
  hash: string,
  lang: UgcLocale,
  text: string,
  model: string
): Promise<void> => {
  try {
    await translationsCollection().updateOne(
      { _id: translationCacheKey(hash, lang) },
      {
        $set: { text, model, updatedAt: new Date() },
        $setOnInsert: { hash, lang, createdAt: new Date() }
      },
      { upsert: true }
    );
  } catch (err) {
    console.error('[UGCTranslate] Mongo write failed:', err);
  }
  try {
    await ensureConnected();
    await redis.setEx(
      redisTranslationKey(translationCacheKey(hash, lang)),
      REDIS_TTL_SECONDS,
      text
    );
  } catch (err) {
    console.error('[UGCTranslate] Redis write failed:', err);
  }
};

/**
 * Read-through cache lookup shared by server loaders and the public
 * `/api/ugc/translations` endpoint. Redis MGET first, Mongo `$in` fallback,
 * promoting durable entries back into Redis on the way out.
 */
export const lookupUgcTranslations = async (
  hashes: string[],
  lang: UgcLocale
): Promise<Map<string, string>> => {
  if (hashes.length === 0) return new Map();

  const keys = hashes.map((hash) => translationCacheKey(hash, lang));
  const found = new Map<string, string>();
  const missingHashes: string[] = [];

  try {
    await ensureConnected();
    const cached = await redis.mGet(keys.map(redisTranslationKey));
    for (let index = 0; index < hashes.length; index++) {
      if (typeof cached[index] === 'string') {
        found.set(hashes[index], cached[index]!);
      } else {
        missingHashes.push(hashes[index]);
      }
    }
  } catch (err) {
    console.error('[UGCTranslate] Redis read failed:', err);
    missingHashes.push(...hashes.filter((hash) => !found.has(hash)));
  }

  if (missingHashes.length > 0) {
    try {
      const stored = await translationsCollection()
        .find({ _id: { $in: missingHashes.map((hash) => translationCacheKey(hash, lang)) } })
        .toArray();
      for (const doc of stored) {
        // Empty text = negative cache (identity/untranslatable); keep it in
        // the map so callers can distinguish "definitely none" from
        // "not attempted".
        found.set(doc.hash, doc.text);
        if (doc.text) {
          void (async () => {
            try {
              await ensureConnected();
              await redis.setEx(
                redisTranslationKey(translationCacheKey(doc.hash, doc.lang)),
                REDIS_TTL_SECONDS,
                doc.text
              );
            } catch (err) {
              console.error('[UGCTranslate] Redis promote failed:', err);
            }
          })();
        }
      }
    } catch (err) {
      console.error('[UGCTranslate] Mongo read failed:', err);
    }
  }

  return found;
};

const mergeAttachment = (
  item: WithUgcTranslations,
  field: string,
  lang: UgcLocale,
  text: string
): void => {
  const attachment: UgcTranslationMap = item._t ?? {};
  const byField = attachment[field] ?? {};
  byField[lang] = text;
  attachment[field] = byField;
  item._t = attachment;
};

/**
 * Maps a `_t` attachment key to the source text on the entity. `_t` keys are
 * user-facing display fields (see UGC_TRANSLATION_FIELDS); entity fields
 * differ (e.g. `shop_name` ← `name`), so the read path needs this indirection
 * to compute the same content hash the write path used.
 */
const SOURCE_TEXT_BY_FIELD: Record<
  string,
  (item: Record<string, unknown>) => string | null | undefined
> = {
  shop_name: (item) => item.name as string,
  shop_description: (item) => item.comment as string,
  shop_address: (item) => (item.address as { detailed?: string } | undefined)?.detailed,
  game_name: (item) => item.name as string,
  game_version: (item) => item.version as string,
  game_cost: (item) => item.cost as string,
  game_description: (item) => item.comment as string,
  organization_description: (item) => item.description as string,
  comment: (item) => item.content as string,
  post: (item) => item.title as string,
  delete_request: (item) => item.reason as string,
  attendance_report: (item) => item.comment as string,
  bio: (item) => item.bio as string
};

/**
 * Attaches cached translations for `fields` onto each item as
 * `_t[field][locale]`. Cached entries only — Workers AI is never called here,
 * so this is safe on SSR hot paths.
 *
 * Returns the same array (mutated in place) for call-site convenience.
 */
export const withUgcTranslations = async <T extends object>(
  items: T[],
  fields: readonly string[],
  lang: string
): Promise<(T & WithUgcTranslations)[]> => {
  // Feature temporarily disabled — skip hash computation + cache reads on
  // SSR hot paths (see switch.ts).
  if (!UGC_TRANSLATION_ENABLED) return items as (T & WithUgcTranslations)[];
  if (!(UGC_LOCALES as readonly string[]).includes(lang)) {
    return items as (T & WithUgcTranslations)[];
  }

  const hashes = await Promise.all(
    items.map(async (item) => {
      const perField: Record<string, string | null> = {};
      for (const field of fields) {
        const raw = SOURCE_TEXT_BY_FIELD[field]?.(item as Record<string, unknown>);
        perField[field] =
          typeof raw === 'string' && normalizeUgcText(raw) ? await ugcTextHash(raw) : null;
      }
      return perField;
    })
  );

  const wanted = new Set<string>();
  for (const perField of hashes) {
    for (const hash of Object.values(perField)) {
      if (hash) wanted.add(hash);
    }
  }

  const found = await lookupUgcTranslations([...wanted], lang as UgcLocale);

  const locale = lang as UgcLocale;
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    for (const [field, hash] of Object.entries(hashes[itemIndex])) {
      const text = hash ? found.get(hash) : undefined;
      // Empty string = negative cache entry: nothing to merge.
      if (text) mergeAttachment(items[itemIndex], field, locale, text);
    }
  }
  return items as (T & WithUgcTranslations)[];
};

/** Typed reader for `_t` attachments produced by withUgcTranslations. */
export const getUgcTranslation = <T extends WithUgcTranslations>(
  item: T,
  field: string,
  lang: string
): string | undefined => {
  if (!(UGC_LOCALES as readonly string[]).includes(lang)) return undefined;
  return item._t?.[field]?.[lang as UgcLocale];
};

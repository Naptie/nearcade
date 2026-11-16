import { implement } from '@orpc/server';
import { ugcContract } from '../contracts/ugc';
import type { ApiContext } from '../context';
import { apiError, rethrowApiError, toWire } from '../errors';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainObject } from '$lib/utils';
import { normalizeUgcTranslationFields } from '$lib/ugc/types';
import { ugcTextHash } from '$lib/ugc/hash';
import { lookupUgcTranslations } from '$lib/ugc/translate.server';
import { enqueueUgcTranslations } from '$lib/ugc/jobs.server';
import { UGC_TRANSLATION_ENABLED } from '$lib/constants';
import type { UgcLocale } from '$lib/ugc/types';
import type { User } from '$lib/auth/types';
import { ugcPreferencesResponseSchema, ugcTranslationsResponseSchema } from '$lib/schemas/ugc';
import { successResponseSchema } from '$lib/schemas/common';

/**
 * The preferences of a caller.
 *
 * The legacy handler answered with `ugcPreferencesResponseSchema.parse(...)`;
 * the oRPC output schema validates the very same body, so the handler hands
 * back the plainified document and the validation happens in the output step.
 */
const buildPreferencesResponse = (user?: User | null) =>
  toPlainObject({
    loggedIn: Boolean(user),
    configured: Boolean(user?.autoTranslation),
    // Legacy plural keys (comments/posts) normalize to the canonical types.
    fields: normalizeUgcTranslationFields(user?.autoTranslation?.fields ?? []),
    promptDismissed: Boolean(user?.autoTranslation?.promptDismissed)
  });

const impl = implement(ugcContract).$context<ApiContext>();

export const ugcImplementation = {
  /** `GET /api/ugc/preferences` */
  getPreferences: impl.getPreferences.handler(async ({ context }) => {
    try {
      return toWire(ugcPreferencesResponseSchema, buildPreferencesResponse(context.user));
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  }),

  /** `POST /api/ugc/preferences` */
  updatePreferences: impl.updatePreferences.handler(async ({ input, context }) => {
    // `guard: 'session'` on the contract already rejected an unauthenticated
    // request, so the session is present by construction.
    const session = context.session!;

    try {
      const { fields, promptDismissed } = input;

      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      // Looked up by the application's `id` field, which is the id the session
      // carries.
      const existing = await usersCollection.findOne(
        { id: session.user.id },
        { projection: { autoTranslation: 1 } }
      );
      if (!existing) {
        apiError('NOT_FOUND', m.user_not_found());
      }

      const current = existing.autoTranslation ?? { fields: [], promptDismissed: false };
      const autoTranslation = {
        fields: fields ?? current.fields,
        promptDismissed: promptDismissed ?? current.promptDismissed
      };
      await usersCollection.updateOne(
        { id: session.user.id },
        {
          $set: {
            autoTranslation,
            updatedAt: new Date()
          }
        }
      );

      return toWire(successResponseSchema, { success: true });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  }),

  /** `POST /api/ugc/translations` */
  translations: impl.translations.handler(async ({ input }) => {
    try {
      const { hashes, lang, sources } = input;

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
      // the source text. Fire-and-forget (never blocks the response); polling
      // delivers the result.
      //
      // The endpoint is unauthenticated and hashes are public (clients send
      // them on every lookup), so `sources` is client-controlled input: a
      // (hash, text) pair whose text does not hash to `hash` would poison the
      // shared cache with a translation of the wrong source text. Verify
      // server-side before anything is enqueued.
      if (sources && UGC_TRANSLATION_ENABLED) {
        const missing = hashes.filter(
          (hash) => !translations[hash] && found.get(hash) !== '' && sources[hash]
        );
        const verified: { hash: string; text: string; target: UgcLocale }[] = [];
        for (const hash of missing) {
          // Size is already enforced by the request schema (`sources` values
          // are capped like MAX_TEXT_LENGTH) — only hash honesty is checked here.
          const text = sources[hash];
          if (!text) continue;
          if ((await ugcTextHash(text)) !== hash) continue;
          verified.push({ hash, text, target: lang as UgcLocale });
        }
        if (verified.length > 0) {
          void enqueueUgcTranslations(verified);
        }
      }

      return toWire(ugcTranslationsResponseSchema, { translations });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};

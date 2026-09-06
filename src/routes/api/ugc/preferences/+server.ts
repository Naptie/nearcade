import { error, isHttpError, isRedirect, json, type RequestHandler } from '@sveltejs/kit';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { ObjectId } from 'mongodb';
import { ugcPreferencesResponseSchema, ugcPreferencesUpdateRequestSchema } from '$lib/schemas/ugc';
import { successResponseSchema } from '$lib/schemas/common';
import { parseJsonOrError } from '$lib/utils/validation.server';
import { toPlainObject } from '$lib/utils';
import { normalizeUgcTranslationFields } from '$lib/ugc/types';
import type { User } from '$lib/auth/types';

const buildPreferencesResponse = (user?: User | null) => {
  const autoTranslation = user?.autoTranslation;
  return ugcPreferencesResponseSchema.parse(
    toPlainObject({
      loggedIn: Boolean(user),
      configured: Boolean(autoTranslation),
      // Legacy plural keys (comments/posts) normalize to the canonical types.
      fields: normalizeUgcTranslationFields(autoTranslation?.fields ?? []),
      promptDismissed: Boolean(autoTranslation?.promptDismissed)
    })
  );
};

/** Signed-in users' AI auto-translation preferences (opt-in per content type). */
export const GET: RequestHandler = async ({ locals }) => {
  try {
    return json(buildPreferencesResponse(locals.user));
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading UGC preferences:', err);
    error(500, m.internal_server_error());
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  try {
    const session = locals.session;
    if (!session?.user) {
      error(401, m.unauthorized());
    }

    const { fields, promptDismissed } = await parseJsonOrError(
      request,
      ugcPreferencesUpdateRequestSchema
    );

    const db = mongo.db();
    const usersCollection = db.collection<User>('users');

    const existing = await usersCollection.findOne(
      { _id: new ObjectId(session.user.id) },
      { projection: { autoTranslation: 1 } }
    );
    if (!existing) {
      error(404, m.user_not_found());
    }

    const current = existing.autoTranslation ?? { fields: [], promptDismissed: false };
    const autoTranslation = {
      fields: fields ?? current.fields,
      promptDismissed: promptDismissed ?? current.promptDismissed
    };
    await usersCollection.updateOne(
      { _id: new ObjectId(session.user.id) },
      {
        $set: {
          autoTranslation,
          updatedAt: new Date()
        }
      }
    );

    return json(successResponseSchema.parse({ success: true }));
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error updating UGC preferences:', err);
    error(500, m.internal_server_error());
  }
};

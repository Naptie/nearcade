import { fail } from '@sveltejs/kit';
import { ObjectId } from 'mongodb';
import type { Actions, PageServerLoad } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { locales } from '$lib/paraglide/runtime';
import {
  normalizeUgcTranslationFields,
  UGC_TRANSLATION_GROUPS,
  type UgcTranslationField
} from '$lib/ugc/types';
import type { User } from '$lib/auth/types';

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();
  return {
    locale: user.locale ?? null,
    // Normalize legacy plural preference keys to the canonical types.
    autoTranslation: user.autoTranslation
      ? {
          ...user.autoTranslation,
          fields: normalizeUgcTranslationFields(user.autoTranslation.fields)
        }
      : null
  };
};

export const actions: Actions = {
  updateTranslation: async ({ request, locals }) => {
    const session = locals.session;
    if (!session?.user) {
      return fail(401, { message: m.unauthorized() });
    }
    const user = session.user;

    try {
      const formData = await request.formData();
      const locale = String(formData.get('locale') ?? '');
      if (!(locales as readonly string[]).includes(locale)) {
        return fail(400, { message: m.validation_error() });
      }

      // The UI presents 8 friendly groups; each group expands to the precise
      // content types it covers (single source: UGC_TRANSLATION_GROUPS).
      const fields: UgcTranslationField[] = [];
      for (const group of UGC_TRANSLATION_GROUPS) {
        if (formData.get(`ugcGroup_${group.id}`) !== 'on') continue;
        for (const type of group.types) {
          if (!fields.includes(type)) fields.push(type);
        }
      }

      const db = mongo.db();
      await db.collection<User>('users').updateOne(
        { _id: new ObjectId(user.id) },
        {
          $set: {
            locale: locale as User['locale'],
            autoTranslation: { fields, promptDismissed: true },
            updatedAt: new Date()
          }
        }
      );

      return { success: true };
    } catch (err) {
      console.error('Error updating translation settings:', err);
      return fail(500, { message: m.internal_server_error() });
    }
  }
};

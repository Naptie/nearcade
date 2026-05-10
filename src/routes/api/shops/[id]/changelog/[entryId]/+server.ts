import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { shopChangelogEntryIdParamSchema } from '$lib/schemas/shops';
import { parseParamsOrError } from '$lib/utils/validation.server';
import { successResponseSchema } from '$lib/schemas/common';

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const session = locals.session;
  if (!session?.user || session.user.userType !== 'site_admin') {
    error(403, m.insufficient_permissions());
  }

  const { id: shopId, entryId } = parseParamsOrError(shopChangelogEntryIdParamSchema, params);

  const db = mongo.db();
  const result = await db.collection('shop_changelog').deleteOne({ shopId, id: entryId });

  if (result.deletedCount === 0) {
    error(404, m.changelog_no_entries());
  }

  return json(successResponseSchema.parse({ success: true }));
};

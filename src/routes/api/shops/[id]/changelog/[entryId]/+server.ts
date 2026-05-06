import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ShopChangelogEntry } from '$lib/types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const session = locals.session;
  if (!session?.user || session.user.userType !== 'site_admin') {
    error(403, m.insufficient_permissions());
  }

  const shopId = parseInt(params.id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  const db = mongo.db();
  const result = await db
    .collection<ShopChangelogEntry>('shop_changelog')
    .deleteOne({ shopId, id: params.entryId });

  if (result.deletedCount === 0) {
    error(404, m.changelog_no_entries());
  }

  return json({ success: true });
};

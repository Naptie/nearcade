import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainArray } from '$lib/utils';
import { parseDateParam, parsePageParam, readParam } from '$lib/admin/list-state';
import {
  getShopChangelogFacets,
  searchShopChangelogEntries
} from '$lib/utils/shops/changelog.server';

const PAGE_SIZE = 20;

/**
 * A `YYYY-MM-DD` upper bound covers the whole day; without this an admin
 * picking "to: today" would silently exclude today's entries.
 */
const endOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
};

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  // The changelog is an audit ledger spanning every shop on the site.
  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  const search = readParam(url, 'search');
  const action = readParam(url, 'action');
  const field = readParam(url, 'field');
  const userId = readParam(url, 'userId');

  const fromParam = readParam(url, 'from');
  const toParam = readParam(url, 'to');
  const from = parseDateParam(url, 'from');
  const rawTo = parseDateParam(url, 'to');
  const to = rawTo ? (toParam.length <= 10 ? endOfDay(rawTo) : rawTo) : null;

  const shopIdRaw = readParam(url, 'shopId');
  const shopIdNum = Number(shopIdRaw);
  const shopId = shopIdRaw && Number.isFinite(shopIdNum) ? shopIdNum : undefined;

  const currentPage = parsePageParam(url);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const [result, facets] = await Promise.all([
    searchShopChangelogEntries(
      mongo,
      { search, action, field, userId, shopId, from, to, limit: PAGE_SIZE, offset },
      session.user
    ),
    // Facets deliberately ignore the action/field/actor/date narrowing so the
    // dropdown options stay populated while the admin drills in.
    getShopChangelogFacets(mongo, { search, shopId })
  ]);

  return {
    entries: toPlainArray(result.entries),
    totalCount: result.total,
    currentPage,
    pageSize: PAGE_SIZE,
    search,
    action,
    field,
    userId,
    shopId: shopId ?? null,
    from: fromParam,
    to: toParam,
    facets: {
      actions: facets.actions,
      fields: facets.fields,
      users: facets.users,
      shopCount: facets.shopCount,
      newest: facets.newest ? facets.newest.toISOString() : null,
      oldest: facets.oldest ? facets.oldest.toISOString() : null
    }
  };
};

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainArray } from '$lib/utils';
import { expandShopsRegions } from '$lib/utils/region.server';
import { parseDateParam, parsePageParam, readParam } from '$lib/admin/list-state';
import {
  getDeletedShopFacets,
  searchDeletedShops,
  type DeletedShopSource
} from '$lib/utils/shops/deleted.server';

const PAGE_SIZE = 20;

/**
 * A `YYYY-MM-DD` upper bound covers the whole day; without this an admin
 * picking "deleted to: today" would silently exclude today's deletions.
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

  // This is a site-wide audit archive; region/university admins have no business
  // browsing every removed shop on the platform.
  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  const search = readParam(url, 'search');
  const deletedBy = readParam(url, 'deletedBy');

  const sourceParam = readParam(url, 'source');
  const source: DeletedShopSource | undefined =
    sourceParam === 'request' || sourceParam === 'external' ? sourceParam : undefined;

  const fromParam = readParam(url, 'from');
  const toParam = readParam(url, 'to');
  const from = parseDateParam(url, 'from');
  const rawTo = parseDateParam(url, 'to');
  const to = rawTo ? (toParam.length <= 10 ? endOfDay(rawTo) : rawTo) : null;

  const currentPage = parsePageParam(url);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const [result, facets] = await Promise.all([
    searchDeletedShops(mongo, { search, deletedBy, source, from, to, limit: PAGE_SIZE, offset }),
    // Facets deliberately ignore the admin/source/date narrowing so the
    // dropdown options stay populated while the admin drills in.
    getDeletedShopFacets(mongo, { search })
  ]);

  return {
    // Region names are stored as ids only, so resolve them before the client
    // formats the address.
    shops: toPlainArray(await expandShopsRegions(result.shops)),
    totalCount: result.total,
    // Counted over the same narrowed match as `totalCount`, so the two header
    // stats can never disagree once a source filter is applied.
    requestCount: result.requestCount,
    currentPage,
    pageSize: PAGE_SIZE,
    search,
    deletedBy,
    source: source ?? null,
    from: fromParam,
    to: toParam,
    facets: {
      admins: facets.admins,
      sources: facets.sources,
      newest: facets.newest ? facets.newest.toISOString() : null,
      oldest: facets.oldest ? facets.oldest.toISOString() : null
    }
  };
};

/**
 * The shop list: the paginated shops a client may browse.
 *
 * The filters travel through the shared page-query contract, so the REST
 * endpoint matches the `/shops` page and the globe exactly.
 */

import { implement } from '@orpc/server';
import { queryShops } from '$lib/endpoints/shop-search.server';
import { PAGINATION } from '$lib/constants';
import { shopsListResponseSchema } from '$lib/schemas/shops';
import { toShopApiList } from '$lib/utils/shops/api.server';
import { readShopPageQuery } from '$lib/utils/shops/filter';
import { rethrowApiError } from '../../errors';
import { shopsContract } from '../../contracts/shops';
import type { ApiContext } from '../../context';
import { toPlainWire } from './shared.server';

const impl = implement(shopsContract).$context<ApiContext>();

export const shopsCoreListImplementation = {
  /** `GET /api/shops` */
  list: impl.list.handler(async ({ input, context }) => {
    const limit = input.limit || PAGINATION.PAGE_SIZE;

    // q / sort / f / legacy regionId / titleIds go through the shared
    // page-query contract so the REST endpoint matches the /shops page and
    // the globe exactly. The validated input is replayed as a query string so
    // the parsing itself stays in one place.
    const pageQuery = new URLSearchParams();
    if (input.q) pageQuery.set('q', input.q);
    if (input.sort) pageQuery.set('sort', input.sort);
    pageQuery.set('page', String(input.page));
    if (input.f) pageQuery.set('f', input.f);
    if (input.regionId) pageQuery.set('regionId', input.regionId);
    if (input.titleIds) pageQuery.set('titleIds', input.titleIds);

    const { q, sort, page, filter } = readShopPageQuery(pageQuery);

    try {
      const result = await queryShops({
        filter,
        q,
        sort,
        page,
        limit,
        session: context.session
      });

      const now = new Date();

      return toPlainWire(shopsListResponseSchema, {
        shops: await toShopApiList(result.shops, { includeTimeInfo: input.includeTimeInfo, now }),
        totalCount: result.total,
        currentPage: page,
        hasNextPage: page * limit < result.total,
        hasPrevPage: page > 1
      });
    } catch (err) {
      rethrowApiError(err, 'Failed to search shops');
    }
  })
};

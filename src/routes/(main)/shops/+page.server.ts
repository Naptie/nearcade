import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop, ShopApiAddress } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import { sanitizeHTML, toPlainArray, toPlainObject } from '$lib/utils';
import type { PublicUser } from '$lib/auth/types';
import { m } from '$lib/paraglide/messages';
import {
  generalFromRegion,
  toShopApiAddress,
  buildRegionLabelIndex
} from '$lib/utils/region.server';
import { expandHighlightedBrackets, highlightRegionEntries } from '$lib/utils/search';
import { withUgcTranslations, ugcFieldsForUser } from '$lib/ugc/translate.server';
import { getLocale } from '$lib/paraglide/runtime';
import { readShopPageQuery } from '$lib/utils/shops/filter';
import { queryShops } from '$lib/endpoints/shop-search.server';
import { getShopsAttendanceData } from '$lib/endpoints/attendance.server';
import type { ShopSearchSort } from '$lib/schemas/shop-filter';

/**
 * A search hit exactly as the index/collection returns it: stored shape, region
 * IDs only.
 */
type SearchResultHit = Shop & {
  _rankingScore?: number;
  nameHl?: Shop['name'];
};

/**
 * What the page renders: the public address (localized region names, `general`
 * derived from those names) plus live attendance.
 */
type SearchResultShop = Omit<SearchResultHit, 'address'> & {
  address: ShopApiAddress;
  currentAttendance?: number;
  currentReportedAttendance?: {
    reportedAt: string;
    reportedBy: PublicUser;
    comment: string | null;
  } | null;
};

export const load: PageServerLoad = async ({ url, parent }) => {
  const { q, sort, page, filter } = readShopPageQuery(url.searchParams);
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;

  // Get session data immediately for quick initial render
  const { session } = await parent();

  // Stream the shops data
  const shopsData = (async () => {
    try {
      const result = await queryShops({
        filter,
        q,
        sort,
        page,
        limit,
        session,
        // Only the shop name needs Meili's `_formatted` payload: region names are
        // highlighted locally by `highlightRegionEntries`, from the very same
        // localized names the card renders.
        meiliHighlight: ['name']
      });

      // Search-result highlighting (Meili path only — Mongo hits carry no
      // `_formatted` payload).
      const shops: SearchResultHit[] = await Promise.all(
        result.shops.map(async (hit) => {
          const formatted = hit._formatted as { name?: string } | undefined;
          if (!formatted) return { ...hit } as SearchResultHit;
          return {
            ...hit,
            nameHl: expandHighlightedBrackets(await sanitizeHTML(formatted.name ?? ''), q)
          } as SearchResultHit;
        })
      );

      const enrich = async (input: SearchResultHit[]): Promise<SearchResultShop[]> => {
        // Display attendance (real-time, Redis-backed).
        const attendanceDataMap = await (async () => {
          try {
            return await getShopsAttendanceData(
              input.map((shop) => shop.id),
              { fetchRegistered: true, fetchReported: true, session }
            );
          } catch (err) {
            console.error('Error getting attendance data:', err);
            return null;
          }
        })();

        // Expand region IDs into localized {id, name} entries for display,
        // apply search highlighting to the names, and keep `general` derived
        // from those same names.
        const enriched: SearchResultShop[] = await Promise.all(
          input.map(async (hit) => {
            const address = hit.address
              ? await toShopApiAddress(hit.address)
              : { general: [], detailed: '', region: [] };
            const region = q.trim() ? highlightRegionEntries(address.region, q) : address.region;

            const attendanceData = attendanceDataMap?.get(String(hit.id));
            const latestReport = attendanceData?.reported[0];

            return {
              ...hit,
              address: {
                ...address,
                region,
                general: generalFromRegion(region, address.general)
              },
              currentAttendance: attendanceDataMap ? (attendanceData?.total ?? 0) : 0,
              currentReportedAttendance:
                latestReport?.reporter != null
                  ? {
                      reportedAt: latestReport.reportedAt,
                      reportedBy: latestReport.reporter,
                      comment: latestReport.comment
                    }
                  : null
            };
          })
        );

        // Attach cached shop-name translations for the request locale, for
        // signed-in users who opted into AI translation of shop names.
        await withUgcTranslations(
          enriched,
          ugcFieldsForUser(session?.user, ['shop_name']),
          getLocale()
        );
        return enriched;
      };

      const projectedShops = await enrich(shops);

      let exactMatch: SearchResultShop | null = null;
      if (result.exactMatch) {
        const [enrichedExact] = await enrich([
          { ...result.exactMatch } as unknown as SearchResultHit
        ]);
        exactMatch = toPlainObject(enrichedExact) as unknown as SearchResultShop;
      }

      return {
        shops: toPlainArray(projectedShops) as SearchResultShop[],
        totalCount: result.total,
        approximateTotal: result.approximateTotal,
        strategy: result.strategy,
        currentPage: page,
        hasNextPage: page * limit < result.total,
        hasPrevPage: page > 1,
        exactMatch: exactMatch ? (toPlainObject(exactMatch) as unknown as SearchResultShop) : null
      };
    } catch (err) {
      if (err && (isHttpError(err) || isRedirect(err))) {
        throw err;
      }
      console.error('Error loading shops:', err);
      throw error(500, m.failed_to_load_shops());
    }
  })();

  // Localized labels for the selected region chips, so IDs in the URL render as
  // names in the reader's locale. Shared with the discover and globe pages so
  // one selection never displays differently depending on the surface.
  const { labels: regionLabels } = await buildRegionLabelIndex(filter.regions);

  return {
    shopsData,
    query: q,
    sort: sort as ShopSearchSort,
    filter,
    regionLabels,
    user: session?.user
  };
};

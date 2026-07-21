import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import { sanitizeHTML, sanitizeRecursive, toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { getShopsAttendanceData } from '$lib/endpoints/attendance.server';
import type { PublicUser } from '$lib/auth/types';
import { m } from '$lib/paraglide/messages';
import meili from '$lib/db/meili.server';
import { expandRegionHierarchyWithNames } from '$lib/regions/utils.server';
import { localizeAddressGeneral } from '$lib/utils/region.server';
import {
  buildSearchPattern,
  expandHighlightedBrackets,
  expandHighlightedBracketsRecursive,
  highlightRegionEntries
} from '$lib/utils/search';

export const load: PageServerLoad = async ({ url, parent }) => {
  const query = url.searchParams.get('q') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;
  const skip = (page - 1) * limit;
  const titleIdsParam = url.searchParams.get('titleIds') || '';
  const titleIds = titleIdsParam
    ? titleIdsParam
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id))
    : [];
  const regionId = url.searchParams.get('regionId') || '';

  // Get session data immediately for quick initial render
  const { session } = await parent();

  // Stream the shops data
  const shopsData = (async () => {
    try {
      const db = mongo.db();
      const shopsCollection = db.collection<Shop>('shops');

      let shops: (Shop & {
        _rankingScore?: number;
        nameHl?: Shop['name'];
        addressHl?: Shop['address'];
      })[];
      let totalCount: number;

      // Build base filter for titleIds and regionId
      const titleIdsFilter =
        titleIds.length > 0
          ? {
              $and: titleIds.map((titleId) => ({
                'games.titleId': titleId
              }))
            }
          : {};

      const regionFilter = regionId ? { 'address.region': regionId } : {};

      if (query.trim().length === 0) {
        // Load all shops with pagination
        const baseFilter = {
          ...(titleIds.length > 0 ? titleIdsFilter : {}),
          ...regionFilter
        };
        totalCount = await shopsCollection.countDocuments(baseFilter);
        shops = await shopsCollection
          .find(baseFilter)
          .sort({ name: 1 })
          .collation({ locale: 'zh@collation=gb2312han' })
          .skip(skip)
          .limit(limit)
          .toArray();
      } else {
        const fallbackPattern = buildSearchPattern(query);

        try {
          let filter: string | undefined;
          const filterParts: string[] = [];
          if (titleIds.length > 0) {
            const filters = titleIds.map((id) => `games.titleId = ${id}`);
            filterParts.push(filters.join(' AND '));
          }
          if (regionId) {
            filterParts.push(`address.region = "${regionId}"`);
          }
          if (filterParts.length > 0) {
            filter = filterParts.join(' AND ');
          }

          // Search using Meilisearch
          const searchResults = await meili.index<Shop>('shops').search(query, {
            filter,
            limit,
            offset: skip,
            attributesToHighlight: ['name', 'regionNames', 'address.general', 'address.detailed'],
            highlightPreTag: '<span class="text-highlight">',
            highlightPostTag: '</span>',
            showRankingScore: true
          });

          shops = await Promise.all(
            searchResults.hits.map(
              async (hit) =>
                ({
                  ...hit,
                  ...(hit._formatted
                    ? {
                        nameHl: expandHighlightedBrackets(
                          await sanitizeHTML(hit._formatted.name),
                          query
                        ),
                        addressHl: expandHighlightedBracketsRecursive(
                          await sanitizeRecursive(hit._formatted.address),
                          query
                        )
                      }
                    : {})
                }) as (typeof shops)[number]
            )
          );
          totalCount = searchResults.estimatedTotalHits;
        } catch {
          // Fallback to regex search
          const searchQuery = {
            $and: [
              {
                $or: [
                  { name: { $regex: fallbackPattern, $options: 'is' } },
                  {
                    'address.general': {
                      $elemMatch: { $regex: fallbackPattern, $options: 'is' }
                    }
                  },
                  { 'address.detailed': { $regex: fallbackPattern, $options: 'is' } }
                ]
              },
              ...(titleIds.length > 0 ? [titleIdsFilter] : []),
              ...(regionId ? [{ 'address.region': regionId }] : [])
            ]
          };

          totalCount = await shopsCollection.countDocuments(searchQuery);
          shops = await shopsCollection
            .find(searchQuery)
            .sort({ name: 1 })
            .collation({ locale: 'zh@collation=gb2312han' })
            .skip(skip)
            .limit(limit)
            .toArray();
        }
      }

      // Get real-time attendance data and reported attendance for all shops
      let shopsWithAttendance: ((typeof shops)[number] & {
        currentAttendance: number;
        currentReportedAttendance: {
          reportedAt: string;
          reportedBy: PublicUser;
          comment: string | null;
        } | null;
      })[];

      try {
        const attendanceDataMap = await getShopsAttendanceData(
          shops.map((shop) => shop.id),
          {
            fetchRegistered: true,
            fetchReported: true,
            session
          }
        );

        shopsWithAttendance = shops.map((shop) => {
          const shopIdentifier = shop.id.toString();
          const attendanceData = attendanceDataMap.get(shopIdentifier);

          if (!attendanceData) {
            return {
              ...shop,
              currentAttendance: 0,
              currentReportedAttendance: null
            };
          }

          // Find the latest reported attendance across all games
          const latestReport =
            attendanceData.reported.length > 0 ? attendanceData.reported[0] : null;

          let currentReportedAttendance: {
            reportedAt: string;
            reportedBy: PublicUser;
            comment: string | null;
          } | null = null;

          if (latestReport?.reporter) {
            currentReportedAttendance = {
              reportedAt: latestReport.reportedAt,
              reportedBy: latestReport.reporter,
              comment: latestReport.comment
            };
          }

          return {
            ...shop,
            currentAttendance: attendanceData.total,
            currentReportedAttendance
          };
        });
      } catch (err) {
        console.error('Error getting attendance data:', err);
        shopsWithAttendance = shops.map((shop) => ({
          ...shop,
          currentAttendance: 0,
          currentReportedAttendance: null
        }));
      }

      // Expand region IDs to {id, name}[] for display, apply search highlighting,
      // and localize address.general
      if (shopsWithAttendance.length > 0) {
        shopsWithAttendance = await Promise.all(
          shopsWithAttendance.map(async (shop) => {
            const region = shop.address?.region;
            if (!region || region.length === 0) return shop;
            // If already expanded (objects), apply highlighting and localize
            if (typeof region[0] === 'object') {
              const highlighted = query.trim()
                ? highlightRegionEntries(
                    region as { id: string; name: Record<string, string> }[],
                    query
                  )
                : region;
              const addr = { ...shop.address, region: highlighted };
              return {
                ...shop,
                address: {
                  ...addr,
                  general: localizeAddressGeneral(addr)
                }
              };
            }
            try {
              const expanded = await expandRegionHierarchyWithNames(
                (region as string[])[region.length - 1]
              );
              const highlighted = query.trim() ? highlightRegionEntries(expanded, query) : expanded;
              const localizedAddress = { ...shop.address, region: highlighted };
              return {
                ...shop,
                address: {
                  ...localizedAddress,
                  general: localizeAddressGeneral(localizedAddress)
                }
              };
            } catch {
              return shop;
            }
          })
        );
      }

      return {
        shops: toPlainArray(shopsWithAttendance),
        totalCount,
        currentPage: page,
        hasNextPage: skip + shops.length < totalCount,
        hasPrevPage: page > 1
      };
    } catch (err) {
      if (err && (isHttpError(err) || isRedirect(err))) {
        throw err;
      }
      console.error('Error loading shops:', err);
      throw error(500, m.failed_to_load_shops());
    }
  })();

  return {
    shopsData,
    query,
    titleIds,
    regionId,
    user: session?.user
  };
};

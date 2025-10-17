import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import { sanitizeHTML, sanitizeRecursive, toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { getShopsAttendanceData } from '$lib/endpoints/attendance.server';
import type { User } from '@auth/sveltekit';
import { m } from '$lib/paraglide/messages';
import meili from '$lib/db/meili.server';

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

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    let shops: (Shop & {
      _rankingScore?: number;
      nameHl?: Shop['name'];
      addressHl?: Shop['address'];
    })[];
    let totalCount: number;

    // Build base filter for titleIds
    const titleIdsFilter =
      titleIds.length > 0
        ? {
            $and: titleIds.map((titleId) => ({
              'games.titleId': titleId
            }))
          }
        : {};

    if (query.trim().length === 0) {
      // Load all shops with pagination
      const baseFilter = titleIds.length > 0 ? titleIdsFilter : {};
      totalCount = await shopsCollection.countDocuments(baseFilter);
      shops = await shopsCollection
        .find(baseFilter)
        .sort({ name: 1 })
        .collation({ locale: 'zh@collation=gb2312han' })
        .skip(skip)
        .limit(limit)
        .toArray();
    } else {
      try {
        let filter: string | undefined;
        if (titleIds.length > 0) {
          const filters = titleIds.map((id) => `games.titleId = ${id}`);
          filter = filters.join(' AND ');
        }

        // Search using Meilisearch
        const searchResults = await meili.index<Shop>('shops').search(query, {
          filter,
          limit,
          offset: skip,
          attributesToHighlight: ['name', 'address.general', 'address.detailed'],
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
                      nameHl: await sanitizeHTML(hit._formatted.name),
                      addressHl: await sanitizeRecursive(hit._formatted.address)
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
                { name: { $regex: query, $options: 'i' } },
                { 'address.general': { $elemMatch: { $regex: query, $options: 'i' } } },
                { 'address.detailed': { $regex: query, $options: 'i' } }
              ]
            },
            ...(titleIds.length > 0 ? [titleIdsFilter] : [])
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
    const { session } = await parent();

    let shopsWithAttendance: ((typeof shops)[number] & {
      currentAttendance: number;
      currentReportedAttendance: {
        reportedAt: string;
        reportedBy: User;
        comment: string | null;
      } | null;
    })[];

    try {
      const attendanceDataMap = await getShopsAttendanceData(
        shops.map((shop) => ({ source: shop.source, id: shop.id })),
        {
          fetchRegistered: true,
          fetchReported: true,
          session
        }
      );

      shopsWithAttendance = shops.map((shop) => {
        const shopIdentifier = `${shop.source}-${shop.id}`;
        const attendanceData = attendanceDataMap.get(shopIdentifier);

        if (!attendanceData) {
          return {
            ...shop,
            currentAttendance: 0,
            currentReportedAttendance: null
          };
        }

        // Find the latest reported attendance across all games
        const latestReport = attendanceData.reported.length > 0 ? attendanceData.reported[0] : null;

        let currentReportedAttendance: {
          reportedAt: string;
          reportedBy: User;
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
      // Return shops with zero attendance on error
      shopsWithAttendance = shops.map((shop) => ({
        ...shop,
        currentAttendance: 0,
        currentReportedAttendance: null
      }));
    }

    return {
      shops: toPlainArray(shopsWithAttendance),
      totalCount,
      currentPage: page,
      hasNextPage: skip + shops.length < totalCount,
      hasPrevPage: page > 1,
      query,
      titleIds,
      user: session?.user
    };
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading shops:', err);
    error(500, m.failed_to_load_shops());
  }
};

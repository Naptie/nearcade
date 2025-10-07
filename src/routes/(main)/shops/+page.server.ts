import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { getShopsAttendanceData } from '$lib/endpoints/attendance.server';
import type { User } from '@auth/sveltekit';

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

    let shops: Shop[];
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
      // Search shops
      let searchResults: Shop[];

      try {
        // Try Atlas Search first
        const aggregationPipeline: object[] = [
          {
            $search: {
              index: 'default',
              compound: {
                should: [
                  {
                    text: {
                      query: query,
                      path: 'name',
                      score: { boost: { value: 2 } }
                    }
                  },
                  {
                    text: {
                      query: query,
                      path: 'address.general'
                    }
                  },
                  {
                    text: {
                      query: query,
                      path: 'address.detailed'
                    }
                  }
                ]
              }
            }
          }
        ];

        // Add titleIds filter if present
        if (titleIds.length > 0) {
          aggregationPipeline.push({ $match: titleIdsFilter });
        }

        aggregationPipeline.push(
          { $sort: { score: { $meta: 'searchScore' }, name: 1 } },
          { $skip: skip },
          { $limit: limit }
        );

        searchResults = (await shopsCollection
          .aggregate(aggregationPipeline)
          .toArray()) as unknown as Shop[];
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
        searchResults = await shopsCollection
          .find(searchQuery)
          .sort({ name: 1 })
          .collation({ locale: 'zh@collation=gb2312han' })
          .skip(skip)
          .limit(limit)
          .toArray();
      }

      shops = searchResults;
      if (!totalCount!) {
        totalCount = shops.length + (shops.length === limit ? 1 : 0);
      }
    }

    // Get real-time attendance data and reported attendance for all shops
    const { session } = await parent();

    let shopsWithAttendance: (Shop & {
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
    error(500, 'Failed to load shops');
  }
};

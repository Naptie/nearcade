import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import {
  shopHistoryQuerySchema,
  shopHistoryResponseSchema,
  shopIdParamSchema
} from '$lib/schemas/shops';
import { parseParamsOrError, parseQueryOrError } from '$lib/utils/validation.server';
import { isAdminOrModerator, toPlainArray } from '$lib/utils';
import type { Shop } from '$lib/types';

const HISTORY_VISIBILITY_DAYS = 7;

export const GET: RequestHandler = async ({ params, url, locals }) => {
  try {
    const { id } = parseParamsOrError(shopIdParamSchema, params);
    const { page, limit } = parseQueryOrError(shopHistoryQuerySchema, url);

    const isAdmin = isAdminOrModerator(locals.session?.user);

    const db = mongo.db();

    // Validate shop exists
    const shop = await db.collection<Shop>('shops').findOne({ id });

    if (!shop) {
      error(404, m.shop_not_found());
    }

    // Fetch attendance report history
    const attendanceReportsCollection = db.collection('attendance_reports');

    // Non-admin users can only see reports from the last 7 days
    const filter: Record<string, unknown> = { shopId: id };
    if (!isAdmin) {
      filter.reportedAt = {
        $gte: new Date(Date.now() - HISTORY_VISIBILITY_DAYS * 24 * 60 * 60 * 1000)
      };
    }

    const skip = (page - 1) * limit;

    // Get total count
    const totalCount = await attendanceReportsCollection.countDocuments(filter);

    // Get paginated reports with user data
    const reports = await attendanceReportsCollection
      .aggregate([
        {
          $match: filter
        },
        {
          $sort: { reportedAt: -1 }
        },
        {
          $skip: skip
        },
        {
          $limit: limit
        },
        {
          $lookup: {
            from: 'users',
            localField: 'reportedBy',
            foreignField: 'id',
            as: 'reporter'
          }
        },
        {
          $unwind: {
            path: '$reporter',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            _id: 1,
            shopId: 1,
            games: 1,
            comment: 1,
            reportedBy: 1,
            reportedAt: 1,
            reporter: {
              $cond: {
                if: { $ifNull: ['$reporter', false] },
                then: {
                  id: '$reporter.id',
                  name: '$reporter.name',
                  displayName: '$reporter.displayName',
                  image: '$reporter.image'
                },
                else: '$$REMOVE'
              }
            }
          }
        }
      ])
      .toArray();

    const response = shopHistoryResponseSchema.parse({
      success: true,
      data: toPlainArray(reports),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: skip + reports.length < totalCount
      }
    });

    return json(response);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error getting attendance history:', err);
    error(500, m.internal_server_error());
  }
};

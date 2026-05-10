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
import { toPlainArray } from '$lib/utils';

export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const { id } = parseParamsOrError(shopIdParamSchema, params);
    const { page, limit } = parseQueryOrError(shopHistoryQuerySchema, url);

    const db = mongo.db();

    // Validate shop exists
    const shop = await db.collection('shops').findOne({ id });

    if (!shop) {
      error(404, m.shop_not_found());
    }

    // Fetch attendance report history
    const attendanceReportsCollection = db.collection('attendance_reports');

    const skip = (page - 1) * limit;

    // Get total count
    const totalCount = await attendanceReportsCollection.countDocuments({
      shopId: id
    });

    // Get paginated reports with user data
    const reports = await attendanceReportsCollection
      .aggregate([
        {
          $match: {
            shopId: id
          }
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
              id: '$reporter.id',
              name: '$reporter.name',
              displayName: '$reporter.displayName',
              image: '$reporter.image'
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

import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { AttendanceReportRecord, Shop } from '$lib/types';
import { ShopSource } from '$lib/constants';
import { m } from '$lib/paraglide/messages';

export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const source = params.source as ShopSource;

    // Validate shop source
    if (!Object.values(ShopSource).includes(source)) {
      error(400, m.invalid_shop_source());
    }

    const idRaw = params.id;
    if (!idRaw) {
      error(400, m.invalid_shop_id());
    }
    const id = parseInt(idRaw);

    if (isNaN(id)) {
      error(400, m.invalid_shop_id());
    }

    // Parse pagination parameters
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '10');

    if (page < 1 || limit < 1 || limit > 100) {
      error(400, m.invalid_pagination_parameters());
    }

    const db = mongo.db();

    // Validate shop exists
    const shopsCollection = db.collection<Shop>('shops');
    const shop = await shopsCollection.findOne({
      source,
      id
    });

    if (!shop) {
      error(404, m.shop_not_found());
    }

    // Fetch attendance report history
    const attendanceReportsCollection = db.collection<AttendanceReportRecord>('attendance_reports');

    const skip = (page - 1) * limit;

    // Get total count
    const totalCount = await attendanceReportsCollection.countDocuments({
      'shop.id': id,
      'shop.source': source
    });

    // Get paginated reports with user data
    const reports = await attendanceReportsCollection
      .aggregate([
        {
          $match: {
            'shop.id': id,
            'shop.source': source
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
            shop: 1,
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

    return json({
      success: true,
      data: reports,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: skip + reports.length < totalCount
      }
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error getting attendance history:', err);
    error(500, m.internal_server_error());
  }
};

/**
 * Shop changelog and attendance-report history: the paginated changelog,
 * the admin-only entry delete, and the report history — which is visible in
 * full to administrators and limited to a recent window for everyone else.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { ATTENDANCE_REPORT_HISTORY_VISIBILITY_DAYS } from '$lib/constants';
import { shopChangelogListResponseSchema, shopHistoryResponseSchema } from '$lib/schemas/shops';
import type { Shop } from '$lib/types';
import { isAdminOrModerator, toPlainArray } from '$lib/utils';
import { requireBoundPhone } from '$lib/utils/index.server';
import { getShopChangelogEntries } from '$lib/utils/shops/changelog.server';
import { apiError, rethrowApiError } from '../../errors';
import { shopsContract } from '../../contracts/shops';
import type { ApiContext } from '../../context';
import { toPlainWire } from './shared.server';

const impl = implement(shopsContract).$context<ApiContext>();

export const shopsChangelogImplementation = {
  /** `GET /api/shops/{id}/changelog` */
  changelog: impl.changelog.handler(async ({ input, context }) => {
    const shopId = input.id;
    const { page, limit } = input;

    try {
      const { entries, total } = await getShopChangelogEntries(mongo, shopId, {
        limit,
        offset: (page - 1) * limit,
        viewer: context.session?.user ?? null
      });

      return toPlainWire(shopChangelogListResponseSchema, {
        entries,
        total,
        page,
        limit,
        hasMore: page * limit < total,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_fetch_changelog_entries());
    }
  }),

  /** `DELETE /api/shops/{id}/changelog/{entryId}` */
  deleteChangelogEntry: impl.deleteChangelogEntry.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user || session.user.userType !== 'site_admin') {
      apiError('FORBIDDEN', m.insufficient_permissions());
    }

    requireBoundPhone(session.user);

    const { id: shopId, entryId } = input;

    const db = mongo.db();
    const result = await db.collection('shop_changelog').deleteOne({ shopId, id: entryId });

    if (result.deletedCount === 0) {
      apiError('NOT_FOUND', m.changelog_no_entries());
    }

    return { success: true };
  }),

  /** `GET /api/shops/{id}/history` */
  history: impl.history.handler(async ({ input, context }) => {
    try {
      const id = input.id;
      const { page, limit } = input;

      const isAdmin = isAdminOrModerator(context.session?.user);

      const db = mongo.db();

      // Validate shop exists
      const shop = await db.collection<Shop>('shops').findOne({ id });

      if (!shop) {
        apiError('NOT_FOUND', m.shop_not_found());
      }

      // Fetch attendance report history
      const attendanceReportsCollection = db.collection('attendance_reports');

      // Non-admin users can only see reports from the last 7 days
      const filter: Record<string, unknown> = { shopId: id };
      if (!isAdmin) {
        filter.reportedAt = {
          $gte: new Date(
            Date.now() - ATTENDANCE_REPORT_HISTORY_VISIBILITY_DAYS * 24 * 60 * 60 * 1000
          )
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

      return toPlainWire(shopHistoryResponseSchema, {
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
    } catch (err) {
      rethrowApiError(err);
    }
  })
};

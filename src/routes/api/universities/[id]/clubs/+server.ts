import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainObject } from '$lib/utils';
import {
  universityClubListResponseSchema,
  universityClubsQuerySchema,
  universityIdParamSchema
} from '$lib/schemas/organizations';
import { normalizeClubDocument } from '$lib/utils/organizations.server';
import { parseParamsOrError, parseQueryOrError } from '$lib/utils/validation.server';

export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const { id: universityId } = parseParamsOrError(universityIdParamSchema, params);
    const { page } = parseQueryOrError(universityClubsQuerySchema, url);
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    const db = mongo.db();
    const universitiesCollection = db.collection('universities');
    const clubsCollection = db.collection('clubs');

    // Check if university exists
    const university = await universitiesCollection.findOne({
      $or: [{ id: universityId }, { slug: universityId }]
    });
    if (!university) {
      error(404, m.university_not_found());
    }

    // Get clubs with pagination
    const clubsAggregation = await clubsCollection
      .aggregate([
        { $match: { universityId: university.id } },
        { $skip: skip },
        { $limit: PAGINATION.PAGE_SIZE },
        {
          $lookup: {
            from: 'club_members',
            localField: 'id',
            foreignField: 'clubId',
            as: 'members'
          }
        },
        {
          $project: {
            _id: 1,
            id: 1,
            name: 1,
            description: 1,
            slug: 1,
            avatarUrl: 1,
            membersCount: { $size: '$members' },
            createdAt: 1
          }
        },
        { $sort: { createdAt: -1 } }
      ])
      .toArray();

    // Check if there are more clubs
    const totalClubs = await clubsCollection.countDocuments({
      universityId: university.id
    });
    const hasMore = page * PAGINATION.PAGE_SIZE < totalClubs;

    const normalizedClubs = clubsAggregation.map((club) => normalizeClubDocument(club));

    return json(
      universityClubListResponseSchema.parse(
        toPlainObject({
          clubs: normalizedClubs,
          hasMore,
          page,
          totalClubs
        })
      )
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading university clubs:', err);
    error(500, m.internal_server_error());
  }
};

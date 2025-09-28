import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import mongo from '$lib/db/index.server';
import type { Club, ClubMember, UniversityMember } from '$lib/types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  try {
    const clubId = params.id;
    const page = parseInt(url.searchParams.get('page') || '1');
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    if (!clubId) {
      error(400, 'Invalid club ID');
    }

    const db = mongo.db();
    const clubsCollection = db.collection<Club>('clubs');
    const membersCollection = db.collection<ClubMember>('club_members');

    // Check if club exists
    const club = await clubsCollection.findOne({
      $or: [{ id: clubId }, { slug: clubId }]
    });
    if (!club) {
      error(404, 'Club not found');
    }

    const session = await locals.auth();
    let isUniversityMember = false;
    if (session?.user) {
      const userMembership = await db.collection<UniversityMember>('university_members').findOne({
        userId: session.user.id,
        universityId: club.universityId
      });
      isUniversityMember = !!userMembership?.memberType;
    }

    // Get members with pagination
    const membersAggregation = await membersCollection
      .aggregate([
        { $match: { clubId: club.id } },
        { $skip: skip },
        { $limit: PAGINATION.PAGE_SIZE },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: 'id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        ...(isUniversityMember
          ? []
          : [
              {
                $match: {
                  'user.isUniversityPublic': true
                }
              }
            ]),
        {
          $project: {
            _id: 1,
            memberType: 1,
            joinedAt: 1,
            user: {
              id: '$user.id',
              name: '$user.name',
              displayName: '$user.displayName',
              image: '$user.image'
            }
          }
        },
        { $sort: { joinedAt: -1 } }
      ])
      .toArray();

    // Check if there are more members
    const totalMembers = await membersCollection.countDocuments({
      clubId: club.id
    });
    const hasMore = page * PAGINATION.PAGE_SIZE < totalMembers;

    return json({
      members: membersAggregation,
      hasMore,
      page,
      totalMembers
    });
  } catch (err) {
    console.error('Error loading club members:', err);
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    error(500, 'Internal server error');
  }
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import client from '$lib/db.server';
import type { Club, ClubMember, UniversityMember } from '$lib/types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  try {
    const clubId = params.id;
    const page = parseInt(url.searchParams.get('page') || '1');
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    if (!clubId) {
      return json({ error: 'Invalid club ID' }, { status: 400 });
    }

    const db = client.db();
    const clubsCollection = db.collection<Club>('clubs');
    const membersCollection = db.collection<ClubMember>('club_members');

    // Check if club exists
    const club = await clubsCollection.findOne({
      $or: [{ id: clubId }, { slug: clubId }]
    });
    if (!club) {
      return json({ error: 'Club not found' }, { status: 404 });
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
  } catch (error) {
    console.error('Error loading club members:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

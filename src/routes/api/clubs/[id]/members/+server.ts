import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import { checkClubPermission } from '$lib/utils';
import client from '$lib/db.server';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
  try {
    const clubId = params.id;
    const page = parseInt(url.searchParams.get('page') || '1');
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    if (!clubId) {
      return json({ error: 'Invalid club ID' }, { status: 400 });
    }

    const db = client.db();
    const clubsCollection = db.collection('clubs');
    const membersCollection = db.collection('club_members');

    // Check if club exists
    const club = await clubsCollection.findOne({
      $or: [{ id: clubId }, { slug: clubId }]
    });
    if (!club) {
      return json({ error: 'Club not found' }, { status: 404 });
    }

    // Check user permissions (optional - members might be publicly viewable)
    const sessionCookie = cookies.get('authjs.session-token');
    if (sessionCookie) {
      const sessionsCollection = db.collection('sessions');
      const session = await sessionsCollection.findOne({ sessionToken: sessionCookie });
      if (session) {
        await checkClubPermission(session.userId, club.id, client);
        // For now, allow anyone to view members - can adjust based on privacy requirements
      }
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
        {
          $project: {
            _id: 1,
            memberType: 1,
            joinedAt: 1,
            user: {
              _id: '$user._id',
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

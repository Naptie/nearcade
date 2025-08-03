import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import { checkUniversityPermission } from '$lib/utils';
import client from '$lib/db.server';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
  try {
    const universityId = params.id;
    const page = parseInt(url.searchParams.get('page') || '1');
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    if (!universityId) {
      return json({ error: 'Invalid university ID' }, { status: 400 });
    }

    const db = client.db();
    const universitiesCollection = db.collection('universities');
    const membersCollection = db.collection('university_members');

    // Check if university exists
    const university = await universitiesCollection.findOne({
      $or: [{ id: universityId }, { slug: universityId }]
    });
    if (!university) {
      return json({ error: 'University not found' }, { status: 404 });
    }

    // Check user permissions
    const sessionCookie = cookies.get('authjs.session-token');
    if (!sessionCookie) {
      return json({ error: 'Access denied' }, { status: 403 });
    }

    // Get user from session
    const sessionsCollection = db.collection('sessions');
    const session = await sessionsCollection.findOne({ sessionToken: sessionCookie });
    if (!session) {
      return json({ error: 'Access denied' }, { status: 403 });
    }

    const userPrivileges = await checkUniversityPermission(session.userId, university.id, client);
    if (!userPrivileges.canEdit && !userPrivileges.canManage) {
      // For now, allow anyone to view members - adjust this based on privacy requirements
      // return json({ error: 'Access denied' }, { status: 403 });
    }

    // Get members with pagination
    const membersAggregation = await membersCollection
      .aggregate([
        { $match: { universityId: university.id } },
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
      universityId: university.id
    });
    const hasMore = page * PAGINATION.PAGE_SIZE < totalMembers;

    return json({
      members: membersAggregation,
      hasMore,
      page,
      totalMembers
    });
  } catch (error) {
    console.error('Error loading university members:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

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
    const clubsCollection = db.collection('clubs');

    // Check if university exists
    const university = await universitiesCollection.findOne({
      $or: [{ id: universityId }, { slug: universityId }]
    });
    if (!university) {
      return json({ error: 'University not found' }, { status: 404 });
    }

    // Check user permissions (optional - clubs might be publicly viewable)
    const sessionCookie = cookies.get('authjs.session-token');
    if (sessionCookie) {
      const sessionsCollection = db.collection('sessions');
      const session = await sessionsCollection.findOne({ sessionToken: sessionCookie });
      if (session) {
        await checkUniversityPermission(session.userId, university.id, client);
        // For now, allow anyone to view clubs - can adjust based on privacy requirements
      }
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

    return json({
      clubs: clubsAggregation,
      hasMore,
      page,
      totalClubs
    });
  } catch (error) {
    console.error('Error loading university clubs:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

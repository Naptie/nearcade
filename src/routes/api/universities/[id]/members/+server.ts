import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import client from '$lib/db.server';
import type { University, UniversityMember } from '$lib/types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  try {
    const universityId = params.id;
    const page = parseInt(url.searchParams.get('page') || '1');
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    if (!universityId) {
      return json({ error: 'Invalid university ID' }, { status: 400 });
    }

    const db = client.db();
    const universitiesCollection = db.collection<University>('universities');
    const membersCollection = db.collection<UniversityMember>('university_members');

    // Check if university exists
    const university = await universitiesCollection.findOne({
      $or: [{ id: universityId }, { slug: universityId }]
    });
    if (!university) {
      return json({ error: 'University not found' }, { status: 404 });
    }

    const session = await locals.auth();
    let isUniversityMember = false;
    if (session?.user) {
      const userMembership = await membersCollection.findOne({
        userId: session.user.id,
        universityId: university.id
      });
      isUniversityMember = !!userMembership?.memberType;
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

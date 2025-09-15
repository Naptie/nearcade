import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import mongo from '$lib/db/index.server';
import type { University, UniversityMember } from '$lib/types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  try {
    const universityId = params.id;
    const page = parseInt(url.searchParams.get('page') || '1');
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    if (!universityId) {
      return error(400, 'Invalid university ID');
    }

    const db = mongo.db();
    const universitiesCollection = db.collection<University>('universities');
    const membersCollection = db.collection<UniversityMember>('university_members');

    // Check if university exists
    const university = await universitiesCollection.findOne({
      $or: [{ id: universityId }, { slug: universityId }]
    });
    if (!university) {
      return error(404, 'University not found');
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
  } catch (err) {
    console.error('Error loading university members:', err);
    return error(500, 'Internal server error');
  }
};

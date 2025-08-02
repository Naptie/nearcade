import { json, error } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { MongoClient } from 'mongodb';
import type { RequestHandler } from './$types';
import { toPlainArray } from '$lib/utils';
import type { ClubMember, Club, University, UniversityMember } from '$lib/types';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
} else {
  clientPromise = Promise.resolve(client);
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const session = await locals.auth();

  if (!session?.user) {
    throw error(401, 'Unauthorized');
  }

  // Only site admins can access user details
  if (session.user.userType !== 'site_admin') {
    throw error(403, 'Access denied');
  }

  const userId = params.id;

  if (!userId) {
    throw error(400, 'User ID is required');
  }

  try {
    const client = await clientPromise;
    const db = client.db();

    // Get user basic information
    const user = await db.collection('users').findOne({ id: userId });

    if (!user) {
      throw error(404, 'User not found');
    }

    // Get university memberships with university details
    const universityMemberships = (await db
      .collection<UniversityMember>('university_members')
      .aggregate([
        { $match: { userId } },
        {
          $lookup: {
            from: 'universities',
            localField: 'universityId',
            foreignField: 'id',
            as: 'university'
          }
        },
        { $unwind: { path: '$university', preserveNullAndEmptyArrays: true } }
      ])
      .toArray()) as Array<UniversityMember & { university?: University }>;

    // Get club memberships with club details
    const clubMemberships = (await db
      .collection<ClubMember>('club_members')
      .aggregate([
        { $match: { userId } },
        {
          $lookup: {
            from: 'clubs',
            localField: 'clubId',
            foreignField: 'id',
            as: 'club'
          }
        },
        { $unwind: { path: '$club', preserveNullAndEmptyArrays: true } }
      ])
      .toArray()) as Array<ClubMember & { club?: Club }>;

    return json({
      user: toPlainArray([user])[0],
      universityMemberships: toPlainArray(universityMemberships),
      clubMemberships: toPlainArray(clubMemberships)
    });
  } catch (err) {
    console.error('Error fetching user details:', err);
    throw error(500, 'Failed to fetch user details');
  }
};

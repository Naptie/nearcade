import { MONGODB_URI } from '$env/static/private';
import { MongoClient } from 'mongodb';
import type { PageServerLoad } from './$types';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const load: PageServerLoad = async ({ locals }) => {
  const session = await locals.auth();
  const user = session?.user;

  if (!user) {
    return { stats: null };
  }

  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();

    // Get basic statistics
    const stats = {
      totalUsers: await db.collection('users').countDocuments(),
      totalUniversities: await db.collection('universities').countDocuments(),
      totalClubs: await db.collection('clubs').countDocuments(),
      totalShops: await db.collection('shops').countDocuments(),
      totalInvites: await db.collection('invite_links').countDocuments(),
      pendingJoinRequests: await db
        .collection('join_requests')
        .countDocuments({ status: 'pending' })
    };

    // Get recent activity (last 7 days)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentActivity = {
      newUsers: await db.collection('users').countDocuments({
        joinedAt: { $gte: oneWeekAgo }
      }),
      newClubs: await db.collection('clubs').countDocuments({
        createdAt: { $gte: oneWeekAgo }
      }),
      newJoinRequests: await db.collection('join_requests').countDocuments({
        createdAt: { $gte: oneWeekAgo }
      })
    };

    return {
      stats,
      recentActivity
    };
  } catch (err) {
    console.error('Error loading admin dashboard:', err);
    return {
      stats: null,
      recentActivity: null
    };
  }
};

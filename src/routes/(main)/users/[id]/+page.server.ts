import { error } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { MongoClient } from 'mongodb';
import type { PageServerLoad } from './$types';
import type { User } from '@auth/sveltekit';
import type { University, UniversityMember } from '$lib/types';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const session = await locals.auth();
  const { id } = params;

  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();
    const usersCollection = db.collection<User>('users');

    // Get user data
    let user: User | null;
    if (id.startsWith('@')) {
      const username = id.slice(1);
      user = await usersCollection.findOne({ name: username });
    } else {
      user = await usersCollection.findOne({ id });
    }

    if (!user) {
      throw error(404, 'User not found');
    }

    // Check if viewing own profile
    const isOwnProfile = session?.user?._id === user.id;

    // Get university info if user belongs to one
    let university: University | null = null;
    if (isOwnProfile || user.isUniversityPublic) {
      const universityMembersCollection = db.collection<UniversityMember>('university_members');
      const membership = await universityMembersCollection.findOne(
        {
          userId: user.id
        },
        { sort: { joinedAt: -1 } }
      );

      if (membership) {
        const universitiesCollection = db.collection<University>('universities');
        university = await universitiesCollection.findOne(
          {
            id: membership?.universityId
          },
          { projection: { _id: 0 } }
        );
      }
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        displayName: user.displayName,
        image: user.image,
        bio: user.bio,
        userType: user.userType,
        joinedAt: user.joinedAt,
        lastActiveAt: user.lastActiveAt,
        // Only show full data if viewing own profile or if public
        email: isOwnProfile || user.isEmailPublic ? user.email : null,
        frequentingArcades: user.frequentingArcades || []
      },
      university,
      isOwnProfile
    };
  } catch (err) {
    console.error('Error loading user profile:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    throw error(500, 'Failed to load user profile');
  }
};

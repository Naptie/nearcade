import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { User } from '@auth/sveltekit';
import type { University, UniversityMember } from '$lib/types';
import client from '$lib/db.server';

export const load: PageServerLoad = async ({ params, locals }) => {
  const session = await locals.auth();
  const { id } = params;

  try {
    const db = client.db();
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
      error(404, 'User not found');
    }

    // Check if viewing own profile
    const isOwnProfile = session?.user?._id === user.id;

    // Get university info if user belongs to one
    let university: University | null = null;
    const universityMembersCollection = db.collection<UniversityMember>('university_members');
    const universityMembershipCount = await universityMembersCollection.countDocuments({
      userId: user.id
    });
    const clubMembershipCount = await db.collection('club_members').countDocuments({
      userId: user.id
    });

    if (isOwnProfile || user.isUniversityPublic) {
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
        email: isOwnProfile || user.isEmailPublic ? user.email : null
      },
      frequentingArcadesCount: user.frequentingArcades ? user.frequentingArcades.length : 0,
      starredArcadesCount: user.starredArcades ? user.starredArcades.length : 0,
      universityMembershipCount,
      clubMembershipCount,
      university,
      isOwnProfile
    };
  } catch (err) {
    console.error('Error loading user profile:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load user profile');
  }
};

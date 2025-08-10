import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { User } from '@auth/sveltekit';
import type { University, UniversityMember, Shop, Activity } from '$lib/types';
import client from '$lib/db.server';
import { toPlainArray } from '$lib/utils';
import { getUserActivities } from '$lib/activity.server';

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

    // Get arcade data based on privacy settings
    let frequentingArcades: Shop[] = [];
    let starredArcades: Shop[] = [];

    if (isOwnProfile || user.isFrequentingArcadePublic) {
      const frequentingArcadeIds = user.frequentingArcades || [];
      if (frequentingArcadeIds.length > 0) {
        const shopsCollection = db.collection<Shop>('shops');
        frequentingArcades = await shopsCollection
          .find({ id: { $in: frequentingArcadeIds } })
          .toArray();
      }
    }

    if (isOwnProfile || user.isStarredArcadePublic) {
      const starredArcadeIds = user.starredArcades || [];
      if (starredArcadeIds.length > 0) {
        const shopsCollection = db.collection<Shop>('shops');
        starredArcades = await shopsCollection.find({ id: { $in: starredArcadeIds } }).toArray();
      }
    }

    // Get recent activities
    let activities: Activity[] = [];
    if ((isOwnProfile || user.isEmailPublic) && user.id) {
      try {
        activities = await getUserActivities(client, user.id, 15);
      } catch (err) {
        console.error('Error fetching user activities:', err);
        // Don't fail the entire page load if activities fail
        activities = [];
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
        frequentingArcades: toPlainArray(frequentingArcades),
        starredArcades: toPlainArray(starredArcades)
      },
      frequentingArcadesCount: user.frequentingArcades ? user.frequentingArcades.length : 0,
      starredArcadesCount: user.starredArcades ? user.starredArcades.length : 0,
      universityMembershipCount,
      clubMembershipCount,
      university,
      isOwnProfile,
      activities: toPlainArray(activities)
    };
  } catch (err) {
    console.error('Error loading user profile:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load user profile');
  }
};

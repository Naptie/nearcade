import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { UniversityMember, University, Club, ClubMember } from '$lib/types';
import mongo from '$lib/db/index.server';

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();

  if (!user) {
    error(401, 'Unauthorized');
  }

  const userProfile = {
    id: user.id,
    email: user.email,
    name: user.name,
    displayName: user.displayName,
    image: user.image,
    bio: user.bio,
    userType: user.userType,
    joinedAt: user.joinedAt,
    lastActiveAt: user.lastActiveAt
  };

  try {
    const db = mongo.db();
    const universitiesCollection = db.collection<University>('universities');
    const clubsCollection = db.collection<Club>('clubs');

    // Get university info if user is associated with one
    const universityMembersCollection = db.collection<UniversityMember>('university_members');
    const universityMemberships = await universityMembersCollection
      .find({
        userId: user.id
      })
      .toArray();
    const universityIds = universityMemberships.map((m) => m.universityId);
    const universities = await universitiesCollection
      .find({ id: { $in: universityIds } }, { projection: { _id: 0 } })
      .toArray();

    // Get clubs the user is part of
    const clubMembersCollection = db.collection('club_members');
    const clubMemberships = await clubMembersCollection.find({ userId: user.id }).toArray();
    const clubIds = clubMemberships.map((m) => m.clubId);
    const clubs = await clubsCollection
      .find({ id: { $in: clubIds } }, { projection: { _id: 0 } })
      .toArray();

    return {
      userProfile,
      universities,
      clubs: clubs.map((club) => ({
        id: club.id,
        name: club.name,
        description: club.description,
        avatarUrl: club.avatarUrl,
        university: universities.find((u) => u.id === club.universityId) || null
      }))
    };
  } catch (err) {
    console.error('Error loading account settings:', err);
    return {
      userProfile,
      university: null,
      clubs: []
    };
  }
};

export const actions: Actions = {
  leaveUniversity: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const universityId = formData.get('universityId') as string;

      if (!universityId) {
        return fail(400, { message: 'University ID is required' });
      }

      const db = mongo.db();
      const universityMembersCollection = db.collection<UniversityMember>('university_members');

      await universityMembersCollection.deleteOne({
        universityId,
        userId: user.id
      });

      return { success: true, message: 'Left university successfully' };
    } catch (err) {
      console.error('Error leaving university:', err);
      return fail(500, { message: 'Failed to leave university' });
    }
  },

  leaveClub: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const clubId = formData.get('clubId') as string;

      if (!clubId) {
        return fail(400, { message: 'Club ID is required' });
      }

      const db = mongo.db();
      const clubMembersCollection = db.collection<ClubMember>('club_members');

      await clubMembersCollection.deleteOne({
        clubId,
        userId: user.id
      });

      return { success: true, message: 'Left club successfully' };
    } catch (err) {
      console.error('Error leaving club:', err);
      return fail(500, { message: 'Failed to leave club' });
    }
  },

  deleteAccount: async ({ locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    const user = session.user;

    try {
      const db = mongo.db();
      const usersCollection = db.collection('users');
      const accountsCollection = db.collection('accounts');
      const sessionsCollection = db.collection('sessions');
      const universityMembersCollection = db.collection('university_members');
      const clubMembersCollection = db.collection('club_members');
      const joinRequestsCollection = db.collection('join_requests');

      // Delete user profile
      await usersCollection.deleteOne({ id: user.id });

      // Delete associated accounts
      await accountsCollection.deleteMany({ userId: user._id });

      // Delete sessions
      await sessionsCollection.deleteMany({ userId: user._id });

      // Delete university memberships
      await universityMembersCollection.deleteMany({ userId: user.id });

      // Delete club memberships
      await clubMembersCollection.deleteMany({ userId: user.id });

      // Delete join requests
      await joinRequestsCollection.deleteMany({ userId: user.id });

      return { success: true, message: 'Account deleted successfully' };
    } catch (err) {
      console.error('Error deleting account:', err);
      return fail(500, { message: 'Failed to delete account' });
    }
  }
};

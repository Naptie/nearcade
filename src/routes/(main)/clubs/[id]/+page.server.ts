import { error, fail } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { MongoClient } from 'mongodb';
import type { PageServerLoad, Actions } from './$types.js';
import type { Club, University, Shop } from '$lib/types';
import { getClubMembersWithUserData, checkClubPermission } from '$lib/utils';
import { PAGINATION } from '$lib/constants.js';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const { id } = params;
  const session = await locals.auth();

  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();
    const clubsCollection = db.collection('clubs');
    const membersCollection = db.collection('club_members');
    const universitiesCollection = db.collection('universities');
    const shopsCollection = db.collection('shops');

    // Try to find club by ID first, then by slug
    let club = (await clubsCollection.findOne({
      id: id
    })) as unknown as Club | null;

    if (!club) {
      club = (await clubsCollection.findOne({
        slug: id
      })) as unknown as Club | null;
    }

    if (!club) {
      throw error(404, 'Club not found');
    }

    // Get university information
    const university = (await universitiesCollection.findOne({
      id: club.universityId
    })) as University | null;

    // Get member statistics
    const totalMembers = await membersCollection.countDocuments({ clubId: club.id });

    const members = await getClubMembersWithUserData(club.id, mongoClient, {
      limit: PAGINATION.PAGE_SIZE
    });

    // Get starred arcades with pagination
    let starredArcades: Shop[] = [];
    if (club.starredArcades && club.starredArcades.length > 0) {
      // Convert string IDs to numbers for shop queries
      const arcadeIds = club.starredArcades
        .map((id: string) => parseInt(id))
        .filter((id) => !isNaN(id));

      if (arcadeIds.length > 0) {
        const arcadeResults = await shopsCollection
          .find({ id: { $in: arcadeIds } })
          .limit(PAGINATION.PAGE_SIZE)
          .toArray();

        // Convert ObjectId to string for client
        starredArcades = arcadeResults.map((arcade) => ({
          ...arcade,
          _id: arcade._id?.toString()
        })) as Shop[];
      }
    }

    // Check user permissions if authenticated
    const userPermissions = session?.user
      ? await checkClubPermission(session.user.id!, club.id, mongoClient)
      : { canEdit: false, canManage: false };

    // Update calculated fields
    club.membersCount = totalMembers;

    return {
      club: {
        ...club,
        _id: club._id?.toString()
      },
      university: university
        ? {
            ...university,
            _id: university._id?.toString()
          }
        : null,
      members,
      starredArcades,
      stats: {
        totalMembers
      },
      user: session?.user || null,
      userPermissions
    };
  } catch (err) {
    console.error('Error loading club:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    throw error(500, 'Failed to load club data');
  }
};

export const actions: Actions = {
  removeMember: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const clubId = formData.get('clubId') as string;

      if (!targetUserId || !clubId) {
        return fail(400, { message: 'User ID and Club ID are required' });
      }

      const mongoClient = await clientPromise;

      // Check permissions
      const permissions = await checkClubPermission(session.user.id, clubId, mongoClient);
      if (!permissions.canEdit) {
        return fail(403, { message: 'Insufficient permissions' });
      }

      // Verify target user is not admin/moderator if requester is not admin
      if (!permissions.canManage) {
        const db = mongoClient.db();
        const membersCollection = db.collection('club_members');
        const targetMember = await membersCollection.findOne({
          clubId,
          userId: targetUserId
        });

        if (targetMember && ['admin', 'moderator'].includes(targetMember.memberType)) {
          return fail(403, { message: 'Cannot remove admin or moderator members' });
        }
      }

      const db = mongoClient.db();
      const membersCollection = db.collection('club_members');

      // Remove membership
      await membersCollection.deleteOne({
        clubId,
        userId: targetUserId
      });

      return { success: true, message: 'Member removed successfully' };
    } catch (err) {
      console.error('Error removing member:', err);
      return fail(500, { message: 'Failed to remove member' });
    }
  },

  grantModerator: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const clubId = formData.get('clubId') as string;

      if (!targetUserId || !clubId) {
        return fail(400, { message: 'User ID and Club ID are required' });
      }

      const mongoClient = await clientPromise;

      // Only admins can grant moderator roles
      const permissions = await checkClubPermission(session.user.id, clubId, mongoClient);
      if (!permissions.canManage) {
        return fail(403, { message: 'Only admins can grant moderator roles' });
      }

      const db = mongoClient.db();
      const membersCollection = db.collection('club_members');

      // Update membership type
      await membersCollection.updateOne(
        { clubId, userId: targetUserId },
        { $set: { memberType: 'moderator' } }
      );

      return { success: true, message: 'Moderator role granted successfully' };
    } catch (err) {
      console.error('Error granting moderator:', err);
      return fail(500, { message: 'Failed to grant moderator role' });
    }
  },

  revokeModerator: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const clubId = formData.get('clubId') as string;

      if (!targetUserId || !clubId) {
        return fail(400, { message: 'User ID and Club ID are required' });
      }

      const mongoClient = await clientPromise;

      // Only admins can revoke moderator roles
      const permissions = await checkClubPermission(session.user.id, clubId, mongoClient);
      if (!permissions.canManage) {
        return fail(403, { message: 'Only admins can revoke moderator roles' });
      }

      const db = mongoClient.db();
      const membersCollection = db.collection('club_members');

      // Update membership type
      await membersCollection.updateOne(
        { clubId, userId: targetUserId },
        { $set: { memberType: 'member' } }
      );

      return { success: true, message: 'Moderator role revoked successfully' };
    } catch (err) {
      console.error('Error revoking moderator:', err);
      return fail(500, { message: 'Failed to revoke moderator role' });
    }
  },

  grantAdmin: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const clubId = formData.get('clubId') as string;

      if (!targetUserId || !clubId) {
        return fail(400, { message: 'User ID and Club ID are required' });
      }

      const mongoClient = await clientPromise;

      // Check if current user is a site admin (site admins can grant admin without losing their status)
      const db = mongoClient.db();
      const usersCollection = db.collection('users');
      const currentUser = await usersCollection.findOne({ id: session.user.id });

      if (currentUser?.userType !== 'site_admin') {
        return fail(403, { message: 'Only site admins can grant admin privileges' });
      }

      const membersCollection = db.collection('club_members');

      // Promote target user to admin (without demoting current user)
      await membersCollection.updateOne(
        { clubId, userId: targetUserId },
        { $set: { memberType: 'admin' } }
      );

      return { success: true, message: 'Admin privileges granted successfully' };
    } catch (err) {
      console.error('Error granting admin:', err);
      return fail(500, { message: 'Failed to grant admin privileges' });
    }
  },

  transferAdmin: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const clubId = formData.get('clubId') as string;

      if (!targetUserId || !clubId) {
        return fail(400, { message: 'User ID and Club ID are required' });
      }

      const mongoClient = await clientPromise;

      // Only non-site admins can transfer admin privileges (site admins use grantAdmin instead)
      const permissions = await checkClubPermission(session.user.id, clubId, mongoClient);
      if (!permissions.canManage) {
        return fail(403, { message: 'Only admins can transfer admin privileges' });
      }

      // Check if current user is a site admin (they should use grantAdmin instead)
      const db = mongoClient.db();
      const usersCollection = db.collection('users');
      const currentUser = await usersCollection.findOne({ id: session.user.id });

      if (currentUser?.userType === 'site_admin') {
        return fail(403, {
          message: 'Site admins should use grant admin instead of transfer admin'
        });
      }

      const membersCollection = db.collection('club_members');

      // Demote current admin to moderator
      await membersCollection.updateOne(
        { clubId, userId: session.user.id },
        { $set: { memberType: 'moderator' } }
      );

      // Promote target user to admin
      await membersCollection.updateOne(
        { clubId, userId: targetUserId },
        { $set: { memberType: 'admin' } }
      );

      return { success: true, message: 'Admin privileges transferred successfully' };
    } catch (err) {
      console.error('Error transferring admin:', err);
      return fail(500, { message: 'Failed to transfer admin privileges' });
    }
  },

  addArcade: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const arcadeId = formData.get('arcadeId') as string;
      const clubId = formData.get('clubId') as string;

      if (!arcadeId || !clubId) {
        return fail(400, { message: 'Arcade ID and Club ID are required' });
      }

      const mongoClient = await clientPromise;

      // Check permissions
      const permissions = await checkClubPermission(session.user.id, clubId, mongoClient);
      if (!permissions.canEdit) {
        return fail(403, { message: 'Insufficient permissions' });
      }

      const db = mongoClient.db();
      const clubsCollection = db.collection('clubs');
      const shopsCollection = db.collection('shops');

      // Check if arcade exists
      const arcade = await shopsCollection.findOne({ id: parseInt(arcadeId) });
      if (!arcade) {
        return fail(404, { message: 'Arcade not found' });
      }

      // Add arcade to club's starred list
      await clubsCollection.updateOne(
        { id: clubId },
        {
          $addToSet: { starredArcades: arcadeId },
          $set: { updatedAt: new Date() }
        }
      );

      return { success: true, message: 'Arcade added successfully' };
    } catch (err) {
      console.error('Error adding arcade:', err);
      return fail(500, { message: 'Failed to add arcade' });
    }
  },

  removeArcade: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const arcadeId = formData.get('arcadeId') as string;
      const clubId = formData.get('clubId') as string;

      if (!arcadeId || !clubId) {
        return fail(400, { message: 'Arcade ID and Club ID are required' });
      }

      const mongoClient = await clientPromise;

      // Check permissions
      const permissions = await checkClubPermission(session.user.id, clubId, mongoClient);
      if (!permissions.canEdit) {
        return fail(403, { message: 'Insufficient permissions' });
      }

      const db = mongoClient.db();
      const clubsCollection = db.collection('clubs');

      // Remove arcade from club's starred list
      await clubsCollection.updateOne({ id: clubId }, {
        $pull: { starredArcades: arcadeId },
        $set: { updatedAt: new Date() }
      } as Record<string, unknown>);

      return { success: true, message: 'Arcade removed successfully' };
    } catch (err) {
      console.error('Error removing arcade:', err);
      return fail(500, { message: 'Failed to remove arcade' });
    }
  }
};

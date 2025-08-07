import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Club, University, Shop, ClubMember, UniversityMember } from '$lib/types';
import {
  getClubMembersWithUserData,
  checkClubPermission,
  toPlainArray,
  toPlainObject
} from '$lib/utils';
import { PAGINATION } from '$lib/constants';
import { nanoid } from 'nanoid';
import client from '$lib/db.server';

export const load: PageServerLoad = async ({ params, locals }) => {
  const { id } = params;
  const session = await locals.auth();

  try {
    const db = client.db();
    const clubsCollection = db.collection<Club>('clubs');
    const membersCollection = db.collection<ClubMember>('club_members');
    const universitiesCollection = db.collection<University>('universities');
    const universityMembersCollection = db.collection<UniversityMember>('university_members');
    const shopsCollection = db.collection<Shop>('shops');

    // Try to find club by ID first, then by slug
    let club = await clubsCollection.findOne({
      id: id
    });

    if (!club) {
      club = await clubsCollection.findOne({
        slug: id
      });
    }

    if (!club) {
      error(404, 'Club not found');
    }

    // Check user permissions if authenticated
    const userPermissions = session?.user
      ? await checkClubPermission(session.user, club, client)
      : { canEdit: false, canManage: false, canJoin: 0 as const };

    // Get university information
    const university = await universitiesCollection.findOne({
      id: club.universityId
    });

    // Get university membership if user is authenticated
    const universityMembership = session?.user
      ? await universityMembersCollection.findOne({
          universityId: club.universityId,
          userId: session.user.id
        })
      : null;

    // Get member statistics
    const totalMembers = await membersCollection.countDocuments({ clubId: club.id });

    const members = await getClubMembersWithUserData(club.id, client, {
      limit: PAGINATION.PAGE_SIZE,
      filter: universityMembership?.memberType
        ? {}
        : {
            isUniversityPublic: true
          }
    });

    // Get starred arcades with pagination
    let starredArcades: Shop[] = [];
    if (club.starredArcades && club.starredArcades.length > 0) {
      // Convert string IDs to numbers for shop queries
      const arcadeIds = club.starredArcades
        .map((id: string) => parseInt(id))
        .filter((id) => !isNaN(id));

      if (arcadeIds.length > 0) {
        starredArcades = toPlainArray(
          await shopsCollection
            .find({ id: { $in: arcadeIds } })
            .limit(PAGINATION.PAGE_SIZE)
            .toArray()
        );
      }
    }

    // Update calculated fields
    club.membersCount = totalMembers;

    return {
      club: toPlainObject(club),
      university: toPlainObject(university),
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
    error(500, 'Failed to load club data');
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

      // Check permissions
      const permissions = await checkClubPermission(session.user, clubId, client);
      if (!permissions.canEdit) {
        return fail(403, { message: 'Insufficient permissions' });
      }

      // Verify target user is not admin/moderator if requester is not admin
      if (!permissions.canManage) {
        const db = client.db();
        const membersCollection = db.collection('club_members');
        const targetMember = await membersCollection.findOne({
          clubId,
          userId: targetUserId
        });

        if (targetMember && ['admin', 'moderator'].includes(targetMember.memberType)) {
          return fail(403, { message: 'Cannot remove admin or moderator members' });
        }
      }

      const db = client.db();
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

      // Only admins can grant moderator roles
      const permissions = await checkClubPermission(session.user, clubId, client);
      if (!permissions.canManage) {
        return fail(403, { message: 'Only admins can grant moderator roles' });
      }

      const db = client.db();
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

      // Only admins can revoke moderator roles
      const permissions = await checkClubPermission(session.user, clubId, client);
      if (!permissions.canManage) {
        return fail(403, { message: 'Only admins can revoke moderator roles' });
      }

      const db = client.db();
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

      // Check if current user is a site admin (site admins can grant admin without losing their status)
      const db = client.db();
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

      // Only non-site admins can transfer admin privileges (site admins use grantAdmin instead)
      const permissions = await checkClubPermission(session.user, clubId, client);
      if (!permissions.canManage) {
        return fail(403, { message: 'Only admins can transfer admin privileges' });
      }

      // Check if current user is a site admin (they should use grantAdmin instead)
      const db = client.db();
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

      // Check permissions
      const permissions = await checkClubPermission(session.user, clubId, client);
      if (!permissions.canEdit) {
        return fail(403, { message: 'Insufficient permissions' });
      }

      const db = client.db();
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

      // Check permissions
      const permissions = await checkClubPermission(session.user, clubId, client);
      if (!permissions.canEdit) {
        return fail(403, { message: 'Insufficient permissions' });
      }

      const db = client.db();
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
  },

  joinRequest: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const clubId = formData.get('clubId') as string;
      const requestMessage = formData.get('requestMessage') as string;

      if (!clubId) {
        return fail(400, { message: 'Club ID is required' });
      }

      const db = client.db();
      const clubsCollection = db.collection('clubs');
      const clubMembersCollection = db.collection('club_members');
      const universityMembersCollection = db.collection('university_members');
      const joinRequestsCollection = db.collection('join_requests');

      // Check if club exists and accepts join requests
      const club = await clubsCollection.findOne({ id: clubId });
      if (!club) {
        return fail(404, { message: 'Club not found' });
      }

      if (!club.acceptJoinRequests) {
        return fail(400, { message: 'This club does not accept join requests' });
      }

      // Check if user is already a member
      const existingMembership = await clubMembersCollection.findOne({
        clubId: clubId,
        userId: session.user.id
      });

      if (existingMembership) {
        return fail(400, { message: 'You are already a member of this club' });
      }

      // Check if user is a member of the club's university
      const universityMembership = await universityMembersCollection.findOne({
        universityId: club.universityId,
        userId: session.user.id
      });

      if (!universityMembership) {
        return fail(403, {
          message: 'You must be a member of the hosting university to join this club'
        });
      }

      // Check for existing pending join request
      const existingRequest = await joinRequestsCollection.findOne({
        type: 'club',
        targetId: clubId,
        userId: session.user.id,
        status: 'pending'
      });

      if (existingRequest) {
        return fail(400, { message: 'You already have a pending join request for this club' });
      }

      // Create join request
      const joinRequest = {
        id: nanoid(),
        type: 'club' as const,
        targetId: clubId,
        userId: session.user.id,
        requestMessage: requestMessage || null,
        status: 'pending' as const,
        createdAt: new Date()
      };

      await joinRequestsCollection.insertOne(joinRequest);

      return { success: true, message: 'Join request submitted successfully' };
    } catch (err) {
      console.error('Error creating join request:', err);
      return fail(500, { message: 'Failed to submit join request' });
    }
  }
};

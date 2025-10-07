import { error, fail, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
  type Club,
  type University,
  type Shop,
  type ClubMember,
  type UniversityMember
} from '$lib/types';
import {
  getClubMembersWithUserData,
  checkClubPermission,
  canWriteClubPosts,
  toPlainArray,
  toPlainObject
} from '$lib/utils';
import { PAGINATION, ShopSource } from '$lib/constants';
import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, locals }) => {
  const { id } = params;
  const session = await locals.auth();

  try {
    const db = mongo.db();
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
      error(404, m.club_not_found());
    }

    // Check user permissions if authenticated
    const userPermissions = session?.user
      ? await checkClubPermission(session.user, club, mongo)
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

    const members = await getClubMembersWithUserData(club.id, mongo, {
      limit: PAGINATION.PAGE_SIZE,
      userFilter: universityMembership?.memberType
        ? {}
        : {
            isUniversityPublic: true
          }
    });

    // Get starred arcades with pagination
    let starredArcades: Shop[] = [];
    if (club.starredArcades && club.starredArcades.length > 0) {
      // Convert string IDs to numbers for shop queries
      const arcades = club.starredArcades.filter((arcade) => !isNaN(arcade.id));

      if (arcades.length > 0) {
        starredArcades = toPlainArray(
          await shopsCollection
            .find({
              $or: arcades.map((arcade) => {
                return { $and: [{ source: arcade.source }, { id: arcade.id }] };
              })
            })
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
      userPermissions,
      canWritePosts: await canWriteClubPosts(userPermissions, club, session?.user, mongo)
    };
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading club:', err);
    error(500, m.failed_to_load_club_data());
  }
};

export const actions: Actions = {
  removeMember: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const clubId = formData.get('clubId') as string;

      if (!targetUserId || !clubId) {
        return fail(400, { message: m.user_id_and_club_id_are_required() });
      }

      // Check permissions
      const permissions = await checkClubPermission(session.user, clubId, mongo);
      if (!permissions.canEdit) {
        return fail(403, { message: m.insufficient_permissions() });
      }

      // Verify target user is not admin/moderator if requester is not admin
      if (!permissions.canManage) {
        const db = mongo.db();
        const membersCollection = db.collection('club_members');
        const targetMember = await membersCollection.findOne({
          clubId,
          userId: targetUserId
        });

        if (targetMember && ['admin', 'moderator'].includes(targetMember.memberType)) {
          return fail(403, { message: m.cannot_remove_admin_or_moderator_members() });
        }
      }

      const db = mongo.db();
      const membersCollection = db.collection('club_members');

      // Remove membership
      await membersCollection.deleteOne({
        clubId,
        userId: targetUserId
      });

      return { success: true };
    } catch (err) {
      console.error('Error removing member:', err);
      return fail(500, { message: m.failed_to_remove_member() });
    }
  },

  grantModerator: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const clubId = formData.get('clubId') as string;

      if (!targetUserId || !clubId) {
        return fail(400, { message: m.user_id_and_club_id_are_required() });
      }

      // Only admins can grant moderator roles
      const permissions = await checkClubPermission(session.user, clubId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: m.only_admins_can_grant_moderator_roles() });
      }

      const db = mongo.db();
      const membersCollection = db.collection('club_members');

      // Update membership type
      await membersCollection.updateOne(
        { clubId, userId: targetUserId },
        { $set: { memberType: 'moderator' } }
      );

      return { success: true };
    } catch (err) {
      console.error('Error granting moderator:', err);
      return fail(500, { message: m.failed_to_grant_moderator_role() });
    }
  },

  revokeModerator: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const clubId = formData.get('clubId') as string;

      if (!targetUserId || !clubId) {
        return fail(400, { message: m.user_id_and_club_id_are_required() });
      }

      // Only admins can revoke moderator roles
      const permissions = await checkClubPermission(session.user, clubId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: m.only_admins_can_revoke_moderator_roles() });
      }

      const db = mongo.db();
      const membersCollection = db.collection('club_members');

      // Update membership type
      await membersCollection.updateOne(
        { clubId, userId: targetUserId },
        { $set: { memberType: 'member' } }
      );

      return { success: true };
    } catch (err) {
      console.error('Error revoking moderator:', err);
      return fail(500, { message: m.failed_to_revoke_moderator_role() });
    }
  },

  grantAdmin: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const clubId = formData.get('clubId') as string;

      if (!targetUserId || !clubId) {
        return fail(400, { message: m.user_id_and_club_id_are_required() });
      }

      // Check if current user is a site admin (site admins can grant admin without losing their status)
      const db = mongo.db();
      const usersCollection = db.collection('users');
      const currentUser = await usersCollection.findOne({ id: session.user.id });

      if (currentUser?.userType !== 'site_admin') {
        return fail(403, { message: m.only_site_admins_can_grant_admin_privileges() });
      }

      const membersCollection = db.collection('club_members');

      // Promote target user to admin (without demoting current user)
      await membersCollection.updateOne(
        { clubId, userId: targetUserId },
        { $set: { memberType: 'admin' } }
      );

      return { success: true };
    } catch (err) {
      console.error('Error granting admin:', err);
      return fail(500, { message: m.failed_to_grant_admin_privileges() });
    }
  },

  transferAdmin: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const clubId = formData.get('clubId') as string;

      if (!targetUserId || !clubId) {
        return fail(400, { message: m.user_id_and_club_id_are_required() });
      }

      // Only non-site admins can transfer admin privileges (site admins use grantAdmin instead)
      const permissions = await checkClubPermission(session.user, clubId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: m.only_admins_can_transfer_admin_privileges() });
      }

      // Check if current user is a site admin (they should use grantAdmin instead)
      const db = mongo.db();
      const usersCollection = db.collection('users');
      const currentUser = await usersCollection.findOne({ id: session.user.id });

      if (currentUser?.userType === 'site_admin') {
        return fail(403, {
          message: m.site_admins_should_use_grant_admin_instead_of_transfer_admin()
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

      return { success: true };
    } catch (err) {
      console.error('Error transferring admin:', err);
      return fail(500, { message: m.failed_to_transfer_admin_privileges() });
    }
  },

  addArcade: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const arcadeSource = formData.get('arcadeSource') as ShopSource;
      const arcadeIdRaw = formData.get('arcadeId') as string;
      const arcadeId = parseInt(arcadeIdRaw, 10);
      const clubId = formData.get('clubId') as string;

      if (!arcadeSource) {
        return fail(400, { message: m.arcade_source_is_required() });
      }

      if (!arcadeIdRaw || isNaN(arcadeId) || !clubId) {
        return fail(400, { message: m.arcade_id_and_club_id_are_required() });
      }

      // Check permissions
      const permissions = await checkClubPermission(session.user, clubId, mongo);
      if (!permissions.canEdit) {
        return fail(403, { message: m.insufficient_permissions() });
      }

      const db = mongo.db();
      const clubsCollection = db.collection<Club>('clubs');
      const shopsCollection = db.collection<Shop>('shops');

      // Check if arcade exists
      const arcade = await shopsCollection.findOne({
        id: arcadeId,
        source: arcadeSource
      });
      if (!arcade) {
        return fail(404, { message: m.arcade_not_found() });
      }

      // Add arcade to club's starred list
      await clubsCollection.updateOne(
        { id: clubId },
        {
          $addToSet: { starredArcades: { id: arcadeId, source: arcadeSource } },
          $set: { updatedAt: new Date() }
        }
      );

      return { success: true };
    } catch (err) {
      console.error('Error adding arcade:', err);
      return fail(500, { message: m.failed_to_add_arcade() });
    }
  },

  removeArcade: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const arcadeSource = formData.get('arcadeSource') as ShopSource;
      const arcadeIdRaw = formData.get('arcadeId') as string;
      const arcadeId = parseInt(arcadeIdRaw, 10);
      const clubId = formData.get('clubId') as string;

      if (!arcadeSource) {
        return fail(400, { message: m.arcade_source_is_required() });
      }

      if (!arcadeIdRaw || isNaN(arcadeId) || !clubId) {
        return fail(400, { message: m.arcade_id_and_club_id_are_required() });
      }

      // Check permissions
      const permissions = await checkClubPermission(session.user, clubId, mongo);
      if (!permissions.canEdit) {
        return fail(403, { message: m.insufficient_permissions() });
      }

      const db = mongo.db();
      const clubsCollection = db.collection('clubs');

      // Remove arcade from club's starred list
      await clubsCollection.updateOne({ id: clubId }, {
        $pull: { starredArcades: { id: arcadeId, source: arcadeSource } },
        $set: { updatedAt: new Date() }
      } as Record<string, unknown>);

      return { success: true };
    } catch (err) {
      console.error('Error removing arcade:', err);
      return fail(500, { message: m.failed_to_remove_arcade() });
    }
  },

  joinRequest: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const clubId = formData.get('clubId') as string;
      const requestMessage = formData.get('requestMessage') as string;

      if (!clubId) {
        return fail(400, { message: m.club_id_is_required() });
      }

      const db = mongo.db();
      const clubsCollection = db.collection('clubs');
      const clubMembersCollection = db.collection('club_members');
      const universityMembersCollection = db.collection('university_members');
      const joinRequestsCollection = db.collection('join_requests');

      // Check if club exists and accepts join requests
      const club = await clubsCollection.findOne({ id: clubId });
      if (!club) {
        return fail(404, { message: m.club_not_found() });
      }

      if (!club.acceptJoinRequests) {
        return fail(400, { message: m.this_club_does_not_accept_join_requests() });
      }

      // Check if user is already a member
      const existingMembership = await clubMembersCollection.findOne({
        clubId: clubId,
        userId: session.user.id
      });

      if (existingMembership) {
        return fail(400, { message: m.you_are_already_a_member_of_this_club() });
      }

      // Check if user is a member of the club's university
      const universityMembership = await universityMembersCollection.findOne({
        universityId: club.universityId,
        userId: session.user.id
      });

      if (!universityMembership) {
        return fail(403, {
          message: m.you_must_be_a_member_of_the_hosting_university_to_join_this_club()
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
        return fail(400, { message: m.you_already_have_a_pending_join_request_for_this_club() });
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

      return { success: true };
    } catch (err) {
      console.error('Error creating join request:', err);
      return fail(500, { message: m.failed_to_submit_join_request() });
    }
  }
};

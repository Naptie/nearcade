import { error, fail, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { University, Club, Campus, Shop } from '$lib/types';
import {
  checkUniversityPermission,
  getUniversityMembersWithUserData,
  toPlainArray,
  toPlainObject,
  updateUserType
} from '$lib/utils';
import { PAGINATION } from '$lib/constants';
import { logCampusChanges } from '$lib/utils/changelog.server';
import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { id } = params;

  // Get session data immediately
  const { session } = await parent();
  const user = session?.user;

  // Stream the university data
  const universityData = (async () => {
    try {
      const db = mongo.db();
      const universitiesCollection = db.collection('universities');
      const membersCollection = db.collection('university_members');
      const clubsCollection = db.collection('clubs');
      const shopsCollection = db.collection('shops');

      // Try to find university by ID first, then by slug
      let university = (await universitiesCollection.findOne({
        id: id
      })) as unknown as University | null;

      if (!university) {
        university = (await universitiesCollection.findOne({
          slug: id
        })) as unknown as University | null;
      }

      if (!university) {
        throw error(404, m.university_not_found());
      }

      // Check permissions for the current user
      let userPermissions: {
        canEdit: boolean;
        canManage: boolean;
        canJoin: 0 | 1 | 2;
        role?: string;
        verificationEmail?: string;
        verifiedAt?: Date;
      } = {
        canEdit: false,
        canManage: false,
        canJoin: 0
      };
      if (user) {
        userPermissions = await checkUniversityPermission(user, university.id, mongo);
      }

      // Get member statistics and list with user data joined
      const totalMembers = await membersCollection.countDocuments({ universityId: university.id });
      const members = await getUniversityMembersWithUserData(university.id, mongo, {
        limit: PAGINATION.PAGE_SIZE,
        sort: { joinedAt: -1 },
        userFilter: userPermissions.role
          ? {}
          : {
              isUniversityPublic: true
            }
      });

      // Get clubs belonging to this university
      const totalClubs = await clubsCollection.countDocuments({ universityId: university.id });
      const clubs = (await clubsCollection
        .find({ universityId: university.id })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray()) as unknown as Club[];

      university.studentsCount = totalMembers;

      // Get frequenting arcades for the university
      let frequentingArcades: Shop[] = [];
      if (university.frequentingArcades && university.frequentingArcades.length > 0) {
        const frequentingArcadeIdentifiers = university.frequentingArcades.slice(
          0,
          PAGINATION.PAGE_SIZE
        );
        frequentingArcades = (await shopsCollection
          .find({
            $or: frequentingArcadeIdentifiers.map((identifier: { id: number; source: string }) => ({
              id: identifier.id,
              source: identifier.source
            }))
          })
          .toArray()) as unknown as Shop[];
      }

      return {
        university: toPlainObject(university),
        userPermissions,
        members,
        clubs: toPlainArray(clubs),
        frequentingArcades: toPlainArray(frequentingArcades),
        stats: {
          totalMembers,
          totalClubs,
          clubsCount: university.clubsCount || 0,
          frequentingArcadesCount:
            (university.frequentingArcades && university.frequentingArcades.length) || 0
        }
      };
    } catch (err) {
      if (err && (isHttpError(err) || isRedirect(err))) {
        throw err;
      }
      console.error('Error loading university:', err);
      throw error(500, m.failed_to_load_university_data());
    }
  })();

  return {
    universityData,
    user
  };
};

export const actions: Actions = {
  addCampus: async ({ request, locals }) => {
    const user = (await locals.auth())?.user;
    if (!user) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const universityId = formData.get('universityId') as string;
      const id = formData.get('id') as string;
      const name = formData.get('name') as string;
      const address = formData.get('address') as string;
      const latitude = parseFloat(formData.get('latitude') as string);
      const longitude = parseFloat(formData.get('longitude') as string);
      const province = formData.get('province') as string;
      const city = formData.get('city') as string;
      const district = formData.get('district') as string;

      // Check permissions using new system
      const permissions = await checkUniversityPermission(user, universityId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: m.privilege_insufficient() });
      }

      if (!name || !address || !latitude || !longitude) {
        return fail(400, { message: m.missing_required_fields() });
      }

      const db = mongo.db();
      const universitiesCollection = db.collection('universities');

      const newCampus = {
        id: id || nanoid(),
        name,
        address,
        province,
        city,
        district,
        location: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        createdAt: new Date(),
        createdBy: user.id
      };

      await universitiesCollection.updateOne({ id: universityId }, {
        $addToSet: { campuses: newCampus }
      } as object);

      // Log campus addition to changelog
      await logCampusChanges(mongo, universityId, 'campus_added', newCampus as Campus, {
        id: user.id!,
        name: user.name,
        image: user.image
      });

      return { success: true };
    } catch (err) {
      console.error('Error adding campus:', err);
      return fail(500, { message: m.failed_to_add_campus() });
    }
  },

  updateCampus: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const universityId = formData.get('universityId') as string;
      const campusId = formData.get('campusId') as string;
      const name = formData.get('name') as string;
      const address = formData.get('address') as string;
      const latitude = parseFloat(formData.get('latitude') as string);
      const longitude = parseFloat(formData.get('longitude') as string);
      const province = formData.get('province') as string;
      const city = formData.get('city') as string;
      const district = formData.get('district') as string;

      // Check permissions using new system
      const permissions = await checkUniversityPermission(user, universityId, mongo);
      if (!permissions.canEdit) {
        return fail(403, { message: m.privilege_insufficient() });
      }

      if (!name || !address || !latitude || !longitude || !campusId) {
        return fail(400, { message: m.missing_required_fields() });
      }

      const db = mongo.db();
      const universitiesCollection = db.collection('universities');

      // Get current campus data for changelog comparison
      const currentUniversity = await universitiesCollection.findOne(
        { id: universityId },
        { projection: { campuses: 1 } }
      );
      const currentCampus = currentUniversity?.campuses?.find((c: Campus) => c.id === campusId);

      if (!currentCampus) {
        return fail(404, { message: m.campus_not_found() });
      }

      const updatedCampus: Campus = {
        ...currentCampus,
        name,
        address,
        province,
        city,
        district,
        location: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        updatedAt: new Date(),
        updatedBy: user.id
      };

      await universitiesCollection.updateOne(
        { id: universityId, 'campuses.id': campusId },
        {
          $set: {
            'campuses.$.name': name,
            'campuses.$.address': address,
            'campuses.$.province': province,
            'campuses.$.city': city,
            'campuses.$.district': district,
            'campuses.$.location.type': 'Point',
            'campuses.$.location.coordinates': [longitude, latitude],
            'campuses.$.updatedAt': new Date(),
            'campuses.$.updatedBy': user.id
          }
        }
      );

      // Log campus changes to changelog
      await logCampusChanges(
        mongo,
        universityId,
        'campus_updated',
        updatedCampus,
        {
          id: user.id!,
          name: user.name,
          image: user.image
        },
        currentCampus
      );

      return { success: true };
    } catch (err) {
      console.error('Error updating campus:', err);
      return fail(500, { message: m.failed_to_update_campus() });
    }
  },

  deleteCampus: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const universityId = formData.get('universityId') as string;
      const campusId = formData.get('campusId') as string;

      // Check permissions using new system - only managers can delete
      const permissions = await checkUniversityPermission(user, universityId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: m.privilege_insufficient() });
      }

      if (!campusId) {
        return fail(400, { message: m.campus_id_is_required() });
      }

      const db = mongo.db();
      const universitiesCollection = db.collection('universities');

      // Check if this is the last campus
      const university = await universitiesCollection.findOne({ id: universityId });
      if (!university || university.campuses.length <= 1) {
        return fail(400, { message: m.cannot_delete_the_last_campus() });
      }

      // Get campus data before deletion for changelog
      const campusToDelete = university.campuses.find((c: Campus) => c.id === campusId);
      if (!campusToDelete) {
        return fail(404, { message: m.campus_not_found() });
      }

      await universitiesCollection.updateOne({ id: universityId }, {
        $pull: { campuses: { id: campusId } }
      } as object);
      const updateResult = await universitiesCollection.updateOne({ id: universityId }, {
        $pull: { campuses: { id: campusId } }
      } as object);

      if (updateResult.modifiedCount === 0) {
        return fail(404, { message: m.campus_not_found_or_already_deleted() });
      }
      // Log campus deletion to changelog
      await logCampusChanges(mongo, universityId, 'campus_deleted', campusToDelete, {
        id: user.id!,
        name: user.name,
        image: user.image
      });

      return { success: true };
    } catch (err) {
      console.error('Error deleting campus:', err);
      return fail(500, { message: m.failed_to_delete_campus() });
    }
  },

  inviteMember: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const universityId = formData.get('universityId') as string;
      const email = formData.get('email') as string;
      const memberType = formData.get('memberType') as string;

      // Check permissions using new system - only managers can invite
      const permissions = await checkUniversityPermission(user, universityId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: m.privilege_insufficient() });
      }

      if (!email || !memberType) {
        return fail(400, { message: m.email_and_member_type_are_required() });
      }

      // Validate member type
      if (!['student', 'moderator', 'admin'].includes(memberType)) {
        return fail(400, { message: m.invalid_member_type() });
      }

      const db = mongo.db();
      const usersCollection = db.collection('users');
      const universityMembersCollection = db.collection('university_members');

      // Find user by email
      const targetUser = await usersCollection.findOne({ email });
      if (!targetUser) {
        return fail(400, { message: m.user_not_found() });
      }

      // Check if already a member
      const existingMembership = await universityMembersCollection.findOne({
        userId: targetUser.id, // Use the user's id field, not _id
        universityId
      });

      if (existingMembership) {
        return fail(400, { message: m.user_is_already_a_member() });
      }

      // Create membership
      const newMembership = {
        id: nanoid(),
        universityId,
        userId: targetUser.id,
        memberType,
        joinedAt: new Date()
      };

      await universityMembersCollection.insertOne(newMembership);

      await updateUserType(targetUser.id, mongo);

      return { success: true };
    } catch (err) {
      console.error('Error inviting member:', err);
      return fail(500, { message: m.failed_to_invite_member() });
    }
  },

  removeMember: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const universityId = formData.get('universityId') as string;

      if (!targetUserId || !universityId) {
        return fail(400, { message: m.user_id_and_university_id_are_required() });
      }

      // Check permissions
      const permissions = await checkUniversityPermission(session.user, universityId, mongo);
      if (!permissions.canEdit) {
        return fail(403, { message: m.insufficient_permissions() });
      }

      // Verify target user is not admin/moderator if requester is not admin
      if (!permissions.canManage) {
        const db = mongo.db();
        const membersCollection = db.collection('university_members');
        const targetMember = await membersCollection.findOne({
          universityId,
          userId: targetUserId
        });

        if (targetMember && ['admin', 'moderator'].includes(targetMember.memberType)) {
          return fail(403, { message: m.cannot_remove_admin_or_moderator_members() });
        }
      }

      const db = mongo.db();
      const membersCollection = db.collection('university_members');

      // Remove membership
      await membersCollection.deleteOne({
        universityId,
        userId: targetUserId
      });

      await updateUserType(targetUserId, mongo);

      return { success: true };
    } catch (err) {
      console.error('Error removing member:', err);
      return fail(500, { message: m.failed_to_remove_member() });
    }
  },

  grantModerator: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const universityId = formData.get('universityId') as string;

      if (!targetUserId || !universityId) {
        return fail(400, { message: m.user_id_and_university_id_are_required() });
      }

      // Only admins can grant moderator roles
      const permissions = await checkUniversityPermission(session.user, universityId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: m.only_admins_can_grant_moderator_roles() });
      }

      const db = mongo.db();
      const membersCollection = db.collection('university_members');

      // Update membership type
      await membersCollection.updateOne(
        { universityId, userId: targetUserId },
        { $set: { memberType: 'moderator' } }
      );

      // Update user type
      await updateUserType(targetUserId, mongo);

      return { success: true };
    } catch (err) {
      console.error('Error granting moderator:', err);
      return fail(500, { message: m.failed_to_grant_moderator_role() });
    }
  },

  revokeModerator: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const universityId = formData.get('universityId') as string;

      if (!targetUserId || !universityId) {
        return fail(400, { message: m.user_id_and_university_id_are_required() });
      }

      // Only admins can revoke moderator roles
      const permissions = await checkUniversityPermission(session.user, universityId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: m.only_admins_can_revoke_moderator_roles() });
      }

      const db = mongo.db();
      const membersCollection = db.collection('university_members');

      // Update membership type
      await membersCollection.updateOne(
        { universityId, userId: targetUserId },
        { $set: { memberType: 'student' } }
      );

      // Update user type
      await updateUserType(targetUserId, mongo);

      return { success: true };
    } catch (err) {
      console.error('Error revoking moderator:', err);
      return fail(500, { message: m.failed_to_revoke_moderator_role() });
    }
  },

  grantAdmin: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const universityId = formData.get('universityId') as string;

      if (!targetUserId || !universityId) {
        return fail(400, { message: m.user_id_and_university_id_are_required() });
      }

      // Check if current user is a site admin (site admins can grant admin without losing their status)
      const db = mongo.db();
      const usersCollection = db.collection('users');
      const currentUser = await usersCollection.findOne({ id: session.user.id });

      if (currentUser?.userType !== 'site_admin') {
        return fail(403, { message: m.only_site_admins_can_grant_admin_privileges() });
      }

      const membersCollection = db.collection('university_members');

      // Promote target user to admin (without demoting current user)
      await membersCollection.updateOne(
        { universityId, userId: targetUserId },
        { $set: { memberType: 'admin' } }
      );

      await updateUserType(targetUserId, mongo);

      return { success: true };
    } catch (err) {
      console.error('Error granting admin:', err);
      return fail(500, { message: m.failed_to_grant_admin_privileges() });
    }
  },

  transferAdmin: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const universityId = formData.get('universityId') as string;

      if (!targetUserId || !universityId) {
        return fail(400, { message: m.user_id_and_university_id_are_required() });
      }

      // Only non-site admins can transfer admin privileges (site admins use grantAdmin instead)
      const permissions = await checkUniversityPermission(session.user, universityId, mongo);
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

      const membersCollection = db.collection('university_members');

      // Demote current admin to moderator
      await membersCollection.updateOne(
        { universityId, userId: session.user.id },
        { $set: { memberType: 'moderator' } }
      );

      await updateUserType(session.user.id!, mongo);

      // Promote target user to admin
      await membersCollection.updateOne(
        { universityId, userId: targetUserId },
        { $set: { memberType: 'admin' } }
      );

      await updateUserType(targetUserId, mongo);

      return { success: true };
    } catch (err) {
      console.error('Error transferring admin:', err);
      return fail(500, { message: m.failed_to_transfer_admin_privileges() });
    }
  }
};

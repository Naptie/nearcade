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

export const load: PageServerLoad = async ({ params, parent }) => {
  const { id } = params;

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
      error(404, 'University not found');
    }

    const { session } = await parent();
    const user = session?.user;

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
      user,
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
    error(500, 'Failed to load university data');
  }
};

export const actions: Actions = {
  addCampus: async ({ request, locals }) => {
    const user = (await locals.auth())?.user;
    if (!user) {
      return fail(401, { message: 'Unauthorized' });
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
        return fail(403, { message: 'Insufficient privileges' });
      }

      if (!name || !address || !latitude || !longitude) {
        return fail(400, { message: 'Missing required fields' });
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
      return fail(500, { message: 'Failed to add campus' });
    }
  },

  updateCampus: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
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
        return fail(403, { message: 'Insufficient privileges' });
      }

      if (!name || !address || !latitude || !longitude || !campusId) {
        return fail(400, { message: 'Missing required fields' });
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
        return fail(404, { message: 'Campus not found' });
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
      return fail(500, { message: 'Failed to update campus' });
    }
  },

  deleteCampus: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const universityId = formData.get('universityId') as string;
      const campusId = formData.get('campusId') as string;

      // Check permissions using new system - only managers can delete
      const permissions = await checkUniversityPermission(user, universityId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: 'Insufficient privileges' });
      }

      if (!campusId) {
        return fail(400, { message: 'Campus ID is required' });
      }

      const db = mongo.db();
      const universitiesCollection = db.collection('universities');

      // Check if this is the last campus
      const university = await universitiesCollection.findOne({ id: universityId });
      if (!university || university.campuses.length <= 1) {
        return fail(400, { message: 'Cannot delete the last campus' });
      }

      // Get campus data before deletion for changelog
      const campusToDelete = university.campuses.find((c: Campus) => c.id === campusId);
      if (!campusToDelete) {
        return fail(404, { message: 'Campus not found' });
      }

      await universitiesCollection.updateOne({ id: universityId }, {
        $pull: { campuses: { id: campusId } }
      } as object);
      const updateResult = await universitiesCollection.updateOne({ id: universityId }, {
        $pull: { campuses: { id: campusId } }
      } as object);

      if (updateResult.modifiedCount === 0) {
        return fail(404, { message: 'Campus not found or already deleted' });
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
      return fail(500, { message: 'Failed to delete campus' });
    }
  },

  inviteMember: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
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
        return fail(403, { message: 'Insufficient privileges' });
      }

      if (!email || !memberType) {
        return fail(400, { message: 'Email and member type are required' });
      }

      // Validate member type
      if (!['student', 'moderator', 'admin'].includes(memberType)) {
        return fail(400, { message: 'Invalid member type' });
      }

      const db = mongo.db();
      const usersCollection = db.collection('users');
      const universityMembersCollection = db.collection('university_members');

      // Find user by email
      const targetUser = await usersCollection.findOne({ email });
      if (!targetUser) {
        return fail(400, { message: 'User not found' });
      }

      // Check if already a member
      const existingMembership = await universityMembersCollection.findOne({
        userId: targetUser.id, // Use the user's id field, not _id
        universityId
      });

      if (existingMembership) {
        return fail(400, { message: 'User is already a member' });
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
      return fail(500, { message: 'Failed to invite member' });
    }
  },

  removeMember: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const universityId = formData.get('universityId') as string;

      if (!targetUserId || !universityId) {
        return fail(400, { message: 'User ID and University ID are required' });
      }

      // Check permissions
      const permissions = await checkUniversityPermission(session.user, universityId, mongo);
      if (!permissions.canEdit) {
        return fail(403, { message: 'Insufficient permissions' });
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
          return fail(403, { message: 'Cannot remove admin or moderator members' });
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

      return { success: true, message: 'Member removed successfully' };
    } catch (err) {
      console.error('Error removing member:', err);
      return fail(500, { message: 'Failed to remove member' });
    }
  },

  grantModerator: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const universityId = formData.get('universityId') as string;

      if (!targetUserId || !universityId) {
        return fail(400, { message: 'User ID and University ID are required' });
      }

      // Only admins can grant moderator roles
      const permissions = await checkUniversityPermission(session.user, universityId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: 'Only admins can grant moderator roles' });
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

      return { success: true, message: 'Moderator role granted successfully' };
    } catch (err) {
      console.error('Error granting moderator:', err);
      return fail(500, { message: 'Failed to grant moderator role' });
    }
  },

  revokeModerator: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const universityId = formData.get('universityId') as string;

      if (!targetUserId || !universityId) {
        return fail(400, { message: 'User ID and University ID are required' });
      }

      // Only admins can revoke moderator roles
      const permissions = await checkUniversityPermission(session.user, universityId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: 'Only admins can revoke moderator roles' });
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

      return { success: true, message: 'Moderator role revoked successfully' };
    } catch (err) {
      console.error('Error revoking moderator:', err);
      return fail(500, { message: 'Failed to revoke moderator role' });
    }
  },

  grantAdmin: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const universityId = formData.get('universityId') as string;

      if (!targetUserId || !universityId) {
        return fail(400, { message: 'User ID and University ID are required' });
      }

      // Check if current user is a site admin (site admins can grant admin without losing their status)
      const db = mongo.db();
      const usersCollection = db.collection('users');
      const currentUser = await usersCollection.findOne({ id: session.user.id });

      if (currentUser?.userType !== 'site_admin') {
        return fail(403, { message: 'Only site admins can grant admin privileges' });
      }

      const membersCollection = db.collection('university_members');

      // Promote target user to admin (without demoting current user)
      await membersCollection.updateOne(
        { universityId, userId: targetUserId },
        { $set: { memberType: 'admin' } }
      );

      await updateUserType(targetUserId, mongo);

      return { success: true, message: 'Admin privileges granted successfully' };
    } catch (err) {
      console.error('Error granting admin:', err);
      return fail(500, { message: 'Failed to grant admin privileges' });
    }
  },

  transferAdmin: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const targetUserId = formData.get('userId') as string;
      const universityId = formData.get('universityId') as string;

      if (!targetUserId || !universityId) {
        return fail(400, { message: 'User ID and University ID are required' });
      }

      // Only non-site admins can transfer admin privileges (site admins use grantAdmin instead)
      const permissions = await checkUniversityPermission(session.user, universityId, mongo);
      if (!permissions.canManage) {
        return fail(403, { message: 'Only admins can transfer admin privileges' });
      }

      // Check if current user is a site admin (they should use grantAdmin instead)
      const db = mongo.db();
      const usersCollection = db.collection('users');
      const currentUser = await usersCollection.findOne({ id: session.user.id });

      if (currentUser?.userType === 'site_admin') {
        return fail(403, {
          message: 'Site admins should use grant admin instead of transfer admin'
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

      return { success: true, message: 'Admin privileges transferred successfully' };
    } catch (err) {
      console.error('Error transferring admin:', err);
      return fail(500, { message: 'Failed to transfer admin privileges' });
    }
  }
};

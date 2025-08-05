import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { JoinRequestWithUser } from '$lib/types';
import { checkUniversityPermission, checkClubPermission, toPlainArray } from '$lib/utils';
import { PAGINATION } from '$lib/constants';
import { nanoid } from 'nanoid';
import client from '$lib/db.server';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();
  const user = session?.user;

  if (!user) {
    return { joinRequests: [], hasMore: false };
  }

  try {
    const db = client.db();

    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = PAGINATION.PAGE_SIZE;
    const skip = (page - 1) * limit;

    const status = url.searchParams.get('status') || 'pending';
    const type = url.searchParams.get('type') || 'all';

    // Build query based on user permissions
    const query: Record<string, unknown> = {};

    if (status !== 'all') {
      query.status = status;
    }

    if (type !== 'all') {
      query.type = type;
    }

    // For non-site admins, filter by what they can manage
    if (user.userType !== 'site_admin') {
      const managedTargets: string[] = [];

      // Get universities the user can manage
      const universityMembersCollection = db.collection('university_members');
      const userUniversityMemberships = await universityMembersCollection
        .find({
          userId: user.id,
          memberType: { $in: ['admin', 'moderator'] }
        })
        .toArray();

      for (const membership of userUniversityMemberships) {
        managedTargets.push(membership.universityId);
      }

      // Get clubs the user can manage
      const clubMembersCollection = db.collection('club_members');
      const userClubMemberships = await clubMembersCollection
        .find({
          userId: user.id,
          memberType: { $in: ['admin', 'moderator'] }
        })
        .toArray();

      for (const membership of userClubMemberships) {
        managedTargets.push(membership.clubId);
      }

      if (managedTargets.length === 0) {
        return { joinRequests: [], hasMore: false };
      }

      query.targetId = { $in: managedTargets };
    }

    // Get join requests with user data
    const joinRequestsCollection = db.collection('join_requests');

    const pipeline = [
      { $match: query },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit + 1 }, // Get one extra to check if there are more
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: 'id',
          as: 'user'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'reviewedBy',
          foreignField: 'id',
          as: 'reviewer'
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: false // always has a user
        }
      },
      {
        $unwind: {
          path: '$reviewer',
          preserveNullAndEmptyArrays: true // allow requests with no reviewer
        }
      },
      {
        $project: {
          _id: 1,
          id: 1,
          type: 1,
          targetId: 1,
          userId: 1,
          requestMessage: 1,
          status: 1,
          createdAt: 1,
          reviewedAt: 1,
          reviewedBy: 1,
          reviewNote: 1,
          'user._id': 1,
          'user.id': 1,
          'user.name': 1,
          'user.displayName': 1,
          'user.email': 1,
          'user.image': 1,
          'user.userType': 1,
          'reviewer._id': 1,
          'reviewer.id': 1,
          'reviewer.name': 1,
          'reviewer.displayName': 1,
          'reviewer.email': 1,
          'reviewer.image': 1,
          'reviewer.userType': 1
        }
      }
    ];

    const results = await joinRequestsCollection.aggregate(pipeline).toArray();
    const hasMore = results.length > limit;
    const joinRequests = hasMore ? results.slice(0, -1) : results;

    // Get target entities (universities/clubs) info
    const universitiesCollection = db.collection('universities');
    const clubsCollection = db.collection('clubs');

    const universityTargets = joinRequests
      .filter((req) => req.type === 'university')
      .map((req) => req.targetId);

    const clubTargets = joinRequests
      .filter((req) => req.type === 'club')
      .map((req) => req.targetId);

    const [universities, clubs] = await Promise.all([
      universitiesCollection.find({ id: { $in: universityTargets } }).toArray(),
      clubsCollection.find({ id: { $in: clubTargets } }).toArray()
    ]);

    // Create target lookup map
    const targetMap = new Map();
    universities.forEach((uni) => targetMap.set(uni.id, { ...uni, type: 'university' }));
    clubs.forEach((club) => targetMap.set(club.id, { ...club, type: 'club' }));

    // Attach target info to join requests
    const enrichedJoinRequests = joinRequests.map(
      (req) =>
        ({
          ...req,
          target: targetMap.get(req.targetId) || null
        }) as JoinRequestWithUser & {
          target: Record<string, unknown> | null;
        }
    );

    return {
      joinRequests: toPlainArray(enrichedJoinRequests),
      hasMore,
      currentPage: page,
      filters: { status, type }
    };
  } catch (err) {
    console.error('Error loading join requests:', err);
    return { joinRequests: [], hasMore: false };
  }
};

export const actions: Actions = {
  approve: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const requestId = formData.get('requestId') as string;
      const reviewNote = formData.get('reviewNote') as string;

      if (!requestId) {
        return fail(400, { message: 'Request ID is required' });
      }

      const db = client.db();

      // Get the join request
      const joinRequestsCollection = db.collection('join_requests');
      const joinRequest = await joinRequestsCollection.findOne({ id: requestId });

      if (!joinRequest) {
        return fail(404, { message: 'Join request not found' });
      }

      if (joinRequest.status !== 'pending') {
        return fail(400, { message: 'Join request has already been processed' });
      }

      // Check permissions
      let hasPermission = false;
      if (session.user.userType === 'site_admin') {
        hasPermission = true;
      } else if (joinRequest.type === 'university') {
        const permissions = await checkUniversityPermission(
          session.user,
          joinRequest.targetId,
          client
        );
        hasPermission = permissions.canManage;
      } else if (joinRequest.type === 'club') {
        const permissions = await checkClubPermission(session.user, joinRequest.targetId, client);
        hasPermission = permissions.canManage;
      }

      if (!hasPermission) {
        return fail(403, { message: 'Insufficient permissions' });
      }

      // Create membership
      if (joinRequest.type === 'university') {
        const universityMembersCollection = db.collection('university_members');
        await universityMembersCollection.insertOne({
          id: nanoid(),
          universityId: joinRequest.targetId,
          userId: joinRequest.userId,
          memberType: 'student',
          joinedAt: new Date()
        });
      } else if (joinRequest.type === 'club') {
        const clubMembersCollection = db.collection('club_members');
        await clubMembersCollection.insertOne({
          id: nanoid(),
          clubId: joinRequest.targetId,
          userId: joinRequest.userId,
          memberType: 'member',
          joinedAt: new Date(),
          invitedBy: null
        });

        // Automatically add user to hosting university if not already a member
        const clubsCollection = db.collection('clubs');
        const club = await clubsCollection.findOne({ id: joinRequest.targetId });

        if (club?.universityId) {
          const universityMembersCollection = db.collection('university_members');
          const existingUniversityMember = await universityMembersCollection.findOne({
            universityId: club.universityId,
            userId: joinRequest.userId
          });

          if (!existingUniversityMember) {
            await universityMembersCollection.insertOne({
              id: nanoid(),
              universityId: club.universityId,
              userId: joinRequest.userId,
              memberType: 'student',
              joinedAt: new Date()
            });
          }
        }
      }

      // Update join request status
      await joinRequestsCollection.updateOne(
        { id: requestId },
        {
          $set: {
            status: 'approved',
            reviewedAt: new Date(),
            reviewedBy: session.user.id,
            reviewNote: reviewNote || null
          }
        }
      );

      return { success: true, message: 'Join request approved successfully' };
    } catch (err) {
      console.error('Error approving join request:', err);
      return fail(500, { message: 'Failed to approve join request' });
    }
  },

  reject: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const requestId = formData.get('requestId') as string;
      const reviewNote = formData.get('reviewNote') as string;

      if (!requestId) {
        return fail(400, { message: 'Request ID is required' });
      }

      const db = client.db();

      // Get the join request
      const joinRequestsCollection = db.collection('join_requests');
      const joinRequest = await joinRequestsCollection.findOne({ id: requestId });

      if (!joinRequest) {
        return fail(404, { message: 'Join request not found' });
      }

      if (joinRequest.status !== 'pending') {
        return fail(400, { message: 'Join request has already been processed' });
      }

      // Check permissions
      let hasPermission = false;
      if (session.user.userType === 'site_admin') {
        hasPermission = true;
      } else if (joinRequest.type === 'university') {
        const permissions = await checkUniversityPermission(
          session.user,
          joinRequest.targetId,
          client
        );
        hasPermission = permissions.canManage;
      } else if (joinRequest.type === 'club') {
        const permissions = await checkClubPermission(session.user, joinRequest.targetId, client);
        hasPermission = permissions.canManage;
      }

      if (!hasPermission) {
        return fail(403, { message: 'Insufficient permissions' });
      }

      // Update join request status
      await joinRequestsCollection.updateOne(
        { id: requestId },
        {
          $set: {
            status: 'rejected',
            reviewedAt: new Date(),
            reviewedBy: session.user.id,
            reviewNote: reviewNote || null
          }
        }
      );

      return { success: true, message: 'Join request rejected successfully' };
    } catch (err) {
      console.error('Error rejecting join request:', err);
      return fail(500, { message: 'Failed to reject join request' });
    }
  },

  delete: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const requestId = formData.get('requestId') as string;

      if (!requestId) {
        return fail(400, { message: 'Request ID is required' });
      }

      const db = client.db();

      // Get the join request
      const joinRequestsCollection = db.collection('join_requests');
      const joinRequest = await joinRequestsCollection.findOne({ id: requestId });

      if (!joinRequest) {
        return fail(404, { message: 'Join request not found' });
      }

      // Check permissions (only site admins or the request creator can delete)
      if (session.user.userType !== 'site_admin' && joinRequest.userId !== session.user.id) {
        // Also allow admins/moderators of the target to delete
        let hasPermission = false;
        if (joinRequest.type === 'university') {
          const permissions = await checkUniversityPermission(
            session.user,
            joinRequest.targetId,
            client
          );
          hasPermission = permissions.canManage;
        } else if (joinRequest.type === 'club') {
          const permissions = await checkClubPermission(session.user, joinRequest.targetId, client);
          hasPermission = permissions.canManage;
        }

        if (!hasPermission) {
          return fail(403, { message: 'Insufficient permissions' });
        }
      }

      // Delete join request
      await joinRequestsCollection.deleteOne({ id: requestId });

      return { success: true, message: 'Join request deleted successfully' };
    } catch (err) {
      console.error('Error deleting join request:', err);
      return fail(500, { message: 'Failed to delete join request' });
    }
  }
};

import { json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { InviteLink, UniversityMember, ClubMember, JoinRequest } from '$lib/types';
import { nanoid } from 'nanoid';
import client from '$lib/db/index.server';

export const POST: RequestHandler = async ({ params, locals }) => {
  const { code } = params;
  const session = await locals.auth();

  if (!session?.user) {
    error(401, 'Unauthorized');
  }

  try {
    const db = client.db();

    // Find and validate invite
    const invitesCollection = db.collection<InviteLink>('invite_links');
    const invite = await invitesCollection.findOne({ code, isActive: true });

    if (!invite) {
      error(404, 'Invalid or expired invite link');
    }

    // Check if invite is expired
    if (invite.expiresAt && new Date() > new Date(invite.expiresAt)) {
      error(410, 'This invite link has expired');
    }

    // Check if invite has reached max uses
    if (invite.maxUses && invite.currentUses >= invite.maxUses) {
      error(410, 'This invite link has been used up');
    }

    const userId = session.user.id!;
    let message = '';

    if (invite.type === 'university') {
      const membersCollection = db.collection<UniversityMember>('university_members');

      // Check if user is already a member
      const existingMember = await membersCollection.findOne({
        universityId: invite.targetId,
        userId: userId
      });

      if (existingMember) {
        error(400, 'You are already a member of this university');
      }

      if (invite.requireApproval) {
        // Check if a pending join request already exists
        const joinRequestsCollection = db.collection<JoinRequest>('join_requests');
        const existingRequest = await joinRequestsCollection.findOne({
          type: 'university',
          targetId: invite.targetId,
          userId: userId,
          status: 'pending'
        });

        if (existingRequest) {
          error(400, 'You already have a pending join request for this university');
        }

        // Create join request
        const joinRequest: Omit<JoinRequest, '_id'> = {
          id: nanoid(),
          type: 'university',
          targetId: invite.targetId,
          userId: userId,
          requestMessage: `Join request via invite link: ${invite.title || 'Untitled'}`,
          status: 'pending',
          createdAt: new Date()
        };

        await joinRequestsCollection.insertOne(joinRequest);
        message = 'Join request submitted successfully. Please wait for approval.';
      } else {
        // Add user directly as member
        const member: Omit<UniversityMember, '_id'> = {
          id: nanoid(),
          universityId: invite.targetId,
          userId: userId,
          memberType: 'student',
          joinedAt: new Date()
        };

        await membersCollection.insertOne(member);
        message = 'Successfully joined university!';
      }
    } else if (invite.type === 'club') {
      const clubMembersCollection = db.collection<ClubMember>('club_members');

      // Check if user is already a member
      const existingMember = await clubMembersCollection.findOne({
        clubId: invite.targetId,
        userId: userId
      });

      if (existingMember) {
        error(400, 'You are already a member of this club');
      }

      if (invite.requireApproval) {
        // Check if a pending join request already exists
        const joinRequestsCollection = db.collection<JoinRequest>('join_requests');
        const existingRequest = await joinRequestsCollection.findOne({
          type: 'club',
          targetId: invite.targetId,
          userId: userId,
          status: 'pending'
        });

        if (existingRequest) {
          error(400, 'You already have a pending join request for this club');
        }

        // Create join request
        const joinRequest: Omit<JoinRequest, '_id'> = {
          id: nanoid(),
          type: 'club',
          targetId: invite.targetId,
          userId: userId,
          requestMessage: `Join request via invite link: ${invite.title || 'Untitled'}`,
          status: 'pending',
          createdAt: new Date()
        };

        await joinRequestsCollection.insertOne(joinRequest);
        message = 'Join request submitted successfully. Please wait for approval.';
      } else {
        // Add user directly as member
        message = 'Successfully joined club!';

        // Get club info to find university
        const clubsCollection = db.collection('clubs');
        const club = await clubsCollection.findOne({ id: invite.targetId });

        if (club?.universityId) {
          const universityMembersCollection = db.collection<UniversityMember>('university_members');
          const existingUniversityMember = await universityMembersCollection.findOne({
            universityId: club.universityId,
            userId: userId
          });

          if (!existingUniversityMember) {
            const universityMember: Omit<UniversityMember, '_id'> = {
              id: nanoid(),
              universityId: club.universityId,
              userId: userId,
              memberType: 'student',
              joinedAt: new Date()
            };

            await universityMembersCollection.insertOne(universityMember);
            message = 'Successfully joined club and the host university!';
          }
        }

        const member: Omit<ClubMember, '_id'> = {
          id: nanoid(),
          clubId: invite.targetId,
          userId: userId,
          memberType: 'member',
          joinedAt: new Date(),
          invitedBy: invite.createdBy
        };
        await clubMembersCollection.insertOne(member);
      }
    }

    // Update invite usage count
    await invitesCollection.updateOne(
      { code },
      {
        $inc: { currentUses: 1 },
        $set: { updatedAt: new Date() }
      }
    );

    return json({
      success: true,
      message,
      requiresApproval: invite.requireApproval
    });
  } catch (err) {
    console.error('Error redeeming invite:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to redeem invite');
  }
};

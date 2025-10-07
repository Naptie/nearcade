import { isHttpError, isRedirect, json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { InviteLink, UniversityMember, ClubMember, JoinRequest } from '$lib/types';
import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

export const POST: RequestHandler = async ({ params, locals }) => {
  const { code } = params;
  const session = await locals.auth();

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  try {
    const db = mongo.db();

    // Find and validate invite
    const invitesCollection = db.collection<InviteLink>('invite_links');
    const invite = await invitesCollection.findOne({ code, isActive: true });

    if (!invite) {
      error(404, m.invalid_invite());
    }

    // Check if invite is expired
    if (invite.expiresAt && new Date() > new Date(invite.expiresAt)) {
      error(410, m.this_invite_link_has_expired());
    }

    // Check if invite has reached max uses
    if (invite.maxUses && invite.currentUses >= invite.maxUses) {
      error(410, m.this_invite_link_has_been_used_up());
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
        error(400, m.you_are_already_a_member_of_this_university());
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
          error(400, m.you_already_have_a_pending_join_request_for_this_university());
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
        error(400, m.you_are_already_a_member_of_this_club());
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
          error(400, m.you_already_have_a_pending_join_request_for_this_club());
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
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error redeeming invite:', err);
    error(500, m.failed_to_redeem_invite());
  }
};

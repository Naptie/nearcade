import { json } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { error } from '@sveltejs/kit';
import { MongoClient } from 'mongodb';
import type { RequestHandler } from './$types';
import type { InviteLink, UniversityMember, ClubMember, JoinRequest } from '$lib/types';
import { nanoid } from 'nanoid';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const POST: RequestHandler = async ({ params, locals }) => {
  const { code } = params;
  const session = await locals.auth();

  if (!session?.user) {
    throw error(401, 'Unauthorized');
  }

  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();

    // Find and validate invite
    const invitesCollection = db.collection<InviteLink>('invite_links');
    const invite = await invitesCollection.findOne({ code, isActive: true });

    if (!invite) {
      throw error(404, 'Invalid or expired invite link');
    }

    // Check if invite is expired
    if (invite.expiresAt && new Date() > new Date(invite.expiresAt)) {
      throw error(410, 'This invite link has expired');
    }

    // Check if invite has reached max uses
    if (invite.maxUses && invite.currentUses >= invite.maxUses) {
      throw error(410, 'This invite link has been used up');
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
        throw error(400, 'You are already a member of this university');
      }

      if (invite.requireApproval) {
        // Create join request
        const joinRequestsCollection = db.collection<JoinRequest>('join_requests');
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
        throw error(400, 'You are already a member of this club');
      }

      if (invite.requireApproval) {
        // Create join request
        const joinRequestsCollection = db.collection<JoinRequest>('join_requests');
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
        const member: Omit<ClubMember, '_id'> = {
          id: nanoid(),
          clubId: invite.targetId,
          userId: userId,
          memberType: 'member',
          joinedAt: new Date(),
          invitedBy: invite.createdBy
        };

        await clubMembersCollection.insertOne(member);
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
    throw error(500, 'Failed to redeem invite');
  }
};

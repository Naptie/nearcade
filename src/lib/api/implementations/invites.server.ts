import { implement } from '@orpc/server';
import { nanoid } from 'nanoid';
import {
  inviteRedeemResponseSchema,
  inviteResponseSchema,
  invitesContract
} from '../contracts/invites';
import type { ApiContext } from '../context';
import { apiError, gone, rethrowApiError, toWire } from '../errors';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { checkClubPermission, checkUniversityPermission } from '$lib/utils';
import type { User } from '$lib/auth/types';
import type { ClubMember, InviteLink, JoinRequest, UniversityMember } from '$lib/types';

const impl = implement(invitesContract).$context<ApiContext>();

export const invitesImplementation = {
  create: impl.create.handler(async ({ input, context }) => {
    const session = context.session;

    if (!session?.user) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    try {
      const { type, targetId, title, description, expiresAt, maxUses, requireApproval } = input;

      // Validate input
      if (!type || !targetId) {
        apiError('BAD_REQUEST', m.missing_required_fields());
      }

      if (type !== 'university' && type !== 'club') {
        apiError('BAD_REQUEST', m.invalid_invite_type());
      }

      const db = mongo.db();

      // Only an administrator of the target organization may mint an invite
      // for it — the same rule the "invite members" button in the club and
      // university pages enforces. Without it, any signed-in user could mint
      // an auto-approving invite for any organization and join it outright.
      const permissions =
        type === 'university'
          ? await checkUniversityPermission(session.user, targetId, mongo)
          : await checkClubPermission(session.user, targetId, mongo);

      if (!permissions.canManage) {
        apiError('FORBIDDEN', m.permission_denied());
      }

      const inviteCode = nanoid(12);
      const invite: Omit<InviteLink, '_id'> = {
        id: nanoid(),
        code: inviteCode,
        type,
        targetId,
        createdBy: session.user.id,
        title: title || null,
        description: description || null,
        maxUses: maxUses || null,
        currentUses: 0,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        requireApproval: requireApproval || false,
        isActive: true,
        createdAt: new Date()
      };

      const invitesCollection = db.collection<Omit<InviteLink, '_id'>>('invite_links');
      await invitesCollection.insertOne(invite);

      return toWire(inviteResponseSchema, { invite });
    } catch (err) {
      rethrowApiError(err, m.failed_to_create_invite());
    }
  }),

  redeem: impl.redeem.handler(async ({ input, context }) => {
    const { code } = input;
    const session = context.session;

    if (!session?.user) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    try {
      const db = mongo.db();

      // Find and validate invite
      const invitesCollection = db.collection<InviteLink>('invite_links');
      const invite = await invitesCollection.findOne({ code, isActive: true });

      if (!invite) {
        apiError('NOT_FOUND', m.invalid_invite());
      }

      // Check if invite is expired
      if (invite.expiresAt && new Date() > new Date(invite.expiresAt)) {
        gone(m.this_invite_link_has_expired());
      }

      // Fast path for an invite that is plainly used up, so the caller gets
      // the right error before the membership checks below. The authoritative
      // limit is enforced by the atomic claim further down.
      if (invite.maxUses && invite.currentUses >= invite.maxUses) {
        gone(m.this_invite_link_has_been_used_up());
      }

      // An invite is only as good as the authority of the person who minted
      // it. If that person has since lost the right to invite — they left the
      // organization, or they were demoted — the link must no longer grant
      // access. Without this, an invite minted while someone was an admin
      // stays a permanent key to that organization.
      const creator = await db.collection<User>('users').findOne({ id: invite.createdBy });
      let creatorCanManage = false;

      if (creator) {
        try {
          creatorCanManage =
            invite.type === 'university'
              ? (await checkUniversityPermission(creator, invite.targetId, mongo)).canManage
              : (await checkClubPermission(creator, invite.targetId, mongo)).canManage;
        } catch {
          // The target organization no longer exists, so the invite cannot be
          // honoured. Failing closed keeps a deleted organization unreachable.
          creatorCanManage = false;
        }
      }

      if (!creatorCanManage) {
        apiError('FORBIDDEN', m.access_denied());
      }

      const userId = session.user.id;

      // Whether the caller is already a member is decided *before* a use is
      // claimed, so that redeeming the same invite twice does not burn one of
      // its uses.
      if (invite.type === 'university') {
        const existingMember = await db
          .collection<UniversityMember>('university_members')
          .findOne({ universityId: invite.targetId, userId });

        if (existingMember) {
          apiError('BAD_REQUEST', m.you_are_already_a_member_of_this_university());
        }
      } else if (invite.type === 'club') {
        const existingMember = await db
          .collection<ClubMember>('club_members')
          .findOne({ clubId: invite.targetId, userId });

        if (existingMember) {
          apiError('BAD_REQUEST', m.you_are_already_a_member_of_this_club());
        }
      }

      // A pending request is rejected *before* a use is claimed, for the same
      // reason as the membership check above: clicking the link again while the
      // first request is still pending must not burn another use.
      if (invite.requireApproval) {
        const pendingRequest = await db.collection<JoinRequest>('join_requests').findOne({
          type: invite.type,
          targetId: invite.targetId,
          userId,
          status: 'pending'
        });

        if (pendingRequest) {
          apiError(
            'BAD_REQUEST',
            invite.type === 'university'
              ? m.you_already_have_a_pending_join_request_for_this_university()
              : m.you_already_have_a_pending_join_request_for_this_club()
          );
        }
      }

      // Claim one use of the invite.
      //
      // The limit lives in the *filter* of a single atomic update, so two
      // redemptions racing for the last remaining use cannot both win: the
      // second one no longer matches and is rejected. MongoDB guarantees
      // single-document atomicity, so this needs no transaction — which
      // matters, because the database is a standalone mongod and refuses them.
      const claimed = await invitesCollection.findOneAndUpdate(
        {
          code,
          isActive: true,
          $or: [{ maxUses: null }, { $expr: { $lt: ['$currentUses', '$maxUses'] } }]
        },
        { $inc: { currentUses: 1 }, $set: { updatedAt: new Date() } },
        { returnDocument: 'after' }
      );

      if (!claimed) {
        gone(m.this_invite_link_has_been_used_up());
      }

      let message = '';

      const joinRequestsCollection = db.collection<JoinRequest>('join_requests');

      if (invite.type === 'university') {
        const membersCollection = db.collection<UniversityMember>('university_members');

        if (invite.requireApproval) {
          // Create join request (the "already pending" case was rejected above,
          // before the use was claimed).
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

        if (invite.requireApproval) {
          // Create join request (the "already pending" case was rejected above,
          // before the use was claimed).
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
            const universityMembersCollection =
              db.collection<UniversityMember>('university_members');
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

      return toWire(inviteRedeemResponseSchema, {
        success: true,
        message,
        requiresApproval: invite.requireApproval
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_redeem_invite());
    }
  })
};

import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { UniversityMember, University, Club, ClubMember } from '$lib/types';
import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { m } from '$lib/paraglide/messages';
import { ObjectId } from 'mongodb';
import { getHost, sendWeChatTemplateMessage } from '$lib/utils/index.server';
import { WECHAT_TEMPLATE_BIND_RESULT } from '$env/static/private';

// Define the type for linked accounts
interface LinkedAccount {
  provider: string;
  providerAccountId: string;
}

// Define the supported providers for binding
const SUPPORTED_PROVIDERS = ['qq', 'github', 'microsoft-entra-id', 'phira', 'osu', 'discord'];

export const load: PageServerLoad = async ({ parent, url, request }) => {
  const { user } = await parent();

  if (!user) {
    error(401, m.unauthorized());
  }

  const userProfile = {
    id: user.id,
    email: user.email,
    name: user.name,
    displayName: user.displayName,
    image: user.image,
    bio: user.bio,
    userType: user.userType,
    joinedAt: user.joinedAt,
    lastActiveAt: user.lastActiveAt
  };

  // Check if email needs to be replaced (QQ fake email)
  const needsEmailUpdate = user.email?.endsWith('@qq.nearcade') ?? false;

  // Handle WeChat token if present in URL
  const wechatToken = url.searchParams.get('wechatToken');
  let wechatBindResult: { success: boolean; message?: string } | null = null;

  if (wechatToken) {
    try {
      await ensureConnected();
      const wechatDataStr = await redis.get(`wechat_bind:${wechatToken}`);

      if (wechatDataStr) {
        const wechatData = JSON.parse(wechatDataStr) as { openId: string; token: string };

        // Check if WeChat is already bound
        const db = mongo.db();
        const accountsCollection = db.collection('accounts');
        const existingWechat = await accountsCollection.findOne({
          userId: new ObjectId(user.id),
          provider: 'wechat'
        });

        if (existingWechat) {
          wechatBindResult = { success: false, message: 'wechat_already_bound' };
        } else {
          // Bind WeChat account
          await accountsCollection.insertOne({
            userId: new ObjectId(user.id),
            type: 'oauth',
            provider: 'wechat',
            providerAccountId: wechatData.openId
          });

          // Delete the token from Redis
          await redis.del(`wechat_bind:${wechatToken}`);

          wechatBindResult = { success: true, message: 'wechat_bound_successfully' };

          await sendWeChatTemplateMessage(
            user.id,
            WECHAT_TEMPLATE_BIND_RESULT,
            {
              username: `${user.displayName || `@${user.name}`}${user.displayName !== user.name ? ` (@${user.name})` : ''}`,
              userId: user.id || ''
            },
            `${getHost(request)}/settings/account`
          );
        }
      } else {
        wechatBindResult = { success: false, message: 'wechat_token_invalid_or_expired' };
      }
    } catch (err) {
      console.error('Error processing WeChat bind:', err);
      wechatBindResult = { success: false, message: 'wechat_bind_error' };
    }
  }

  try {
    const db = mongo.db();
    const universitiesCollection = db.collection<University>('universities');
    const clubsCollection = db.collection<Club>('clubs');
    const accountsCollection = db.collection('accounts');

    // Get linked accounts for the user
    const linkedAccountsRaw = await accountsCollection
      .find(
        { userId: new ObjectId(user.id) },
        { projection: { provider: 1, providerAccountId: 1, _id: 0 } }
      )
      .toArray();

    const linkedAccounts: LinkedAccount[] = linkedAccountsRaw.map((acc) => ({
      provider: acc.provider as string,
      providerAccountId: acc.providerAccountId as string
    }));

    // Determine which providers are bound
    const boundProviders = linkedAccounts.map((acc) => acc.provider);

    // Determine which providers can be added
    const availableProviders = SUPPORTED_PROVIDERS.filter((p) => !boundProviders.includes(p));

    // Get university info if user is associated with one
    const universityMembersCollection = db.collection<UniversityMember>('university_members');
    const universityMemberships = await universityMembersCollection
      .find({
        userId: user.id
      })
      .toArray();
    const universityIds = universityMemberships.map((m) => m.universityId);
    const universities = await universitiesCollection
      .find({ id: { $in: universityIds } }, { projection: { _id: 0 } })
      .toArray();

    // Get clubs the user is part of
    const clubMembersCollection = db.collection('club_members');
    const clubMemberships = await clubMembersCollection.find({ userId: user.id }).toArray();
    const clubIds = clubMemberships.map((m) => m.clubId);
    const clubs = await clubsCollection
      .find({ id: { $in: clubIds } }, { projection: { _id: 0 } })
      .toArray();

    return {
      userProfile,
      needsEmailUpdate,
      linkedAccounts,
      boundProviders,
      availableProviders,
      // Include wechat in available if not already bound
      canBindWechat: !boundProviders.includes('wechat'),
      wechatBindResult,
      universities: universities.map((university) => ({
        ...university,
        joinedAt: universityMemberships.find((m) => m.universityId === university.id)!.joinedAt
      })),
      clubs: clubs.map((club) => ({
        id: club.id,
        name: club.name,
        description: club.description,
        avatarUrl: club.avatarUrl,
        university: universities.find((u) => u.id === club.universityId) || null
      }))
    };
  } catch (err) {
    console.error('Error loading account settings:', err);
    return {
      userProfile,
      needsEmailUpdate,
      linkedAccounts: [] as LinkedAccount[],
      boundProviders: [] as string[],
      availableProviders: SUPPORTED_PROVIDERS,
      canBindWechat: true,
      wechatBindResult,
      university: null,
      clubs: []
    };
  }
};

export const actions: Actions = {
  leaveUniversity: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const universityId = formData.get('universityId') as string;

      if (!universityId) {
        return fail(400, { message: m.university_id_is_required() });
      }

      const db = mongo.db();
      const universityMembersCollection = db.collection<UniversityMember>('university_members');

      await universityMembersCollection.deleteOne({
        universityId,
        userId: user.id
      });

      return { success: true };
    } catch (err) {
      console.error('Error leaving university:', err);
      return fail(500, { message: m.failed_to_leave_university() });
    }
  },

  leaveClub: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const clubId = formData.get('clubId') as string;

      if (!clubId) {
        return fail(400, { message: m.club_id_is_required() });
      }

      const db = mongo.db();
      const clubMembersCollection = db.collection<ClubMember>('club_members');

      await clubMembersCollection.deleteOne({
        clubId,
        userId: user.id
      });

      return { success: true };
    } catch (err) {
      console.error('Error leaving club:', err);
      return fail(500, { message: m.failed_to_leave_club() });
    }
  },

  deleteAccount: async ({ locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
    }

    const user = session.user;

    try {
      const db = mongo.db();
      const usersCollection = db.collection('users');
      const accountsCollection = db.collection('accounts');
      const sessionsCollection = db.collection('sessions');
      const universityMembersCollection = db.collection('university_members');
      const clubMembersCollection = db.collection('club_members');
      const joinRequestsCollection = db.collection('join_requests');

      // Delete user profile
      await usersCollection.deleteOne({ id: user.id });

      // Delete associated accounts
      await accountsCollection.deleteMany({ userId: new ObjectId(user.id) });

      // Delete sessions
      await sessionsCollection.deleteMany({ userId: new ObjectId(user.id) });

      // Delete university memberships
      await universityMembersCollection.deleteMany({ userId: user.id });

      // Delete club memberships
      await clubMembersCollection.deleteMany({ userId: user.id });

      // Delete join requests
      await joinRequestsCollection.deleteMany({ userId: user.id });

      return { success: true };
    } catch (err) {
      console.error('Error deleting account:', err);
      return fail(500, { message: m.failed_to_delete_account() });
    }
  }
};

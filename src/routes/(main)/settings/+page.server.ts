import { error, fail } from '@sveltejs/kit';
import { ObjectId } from 'mongodb';
import { nanoid } from 'nanoid';
import type { PageServerLoad, Actions } from './$types';
import mongo from '$lib/db/index.server';
import type { NotificationType } from '$lib/types';
import { m } from '$lib/paraglide/messages';
import type { SocialPlatform } from '$lib/constants';
import { VERIFIABLE_SOCIAL_PLATFORMS } from '$lib/constants';
import { profileSettingsFormSchema } from '$lib/schemas/forms';
import { env } from '$env/dynamic/private';
import { getCachedOAuthProfile } from '$lib/auth/profile-cache';
import {
  parseQbindGroups,
  syncVerifiedSocialLinkFromAccount
} from '$lib/auth/social-verify.server';

export interface SocialLinkInput {
  platform: SocialPlatform;
  username: string;
  verified?: boolean;
}

export interface SocialVerifyResult {
  platform: string;
  success: boolean;
  username?: string;
  error?: 'no_account' | 'resolve_failed' | 'cancelled' | 'error';
}

async function handleOAuthVerification(
  userId: string,
  platform: string
): Promise<SocialVerifyResult> {
  try {
    const db = mongo.db();
    const account = await db
      .collection('accounts')
      .findOne({ userId: new ObjectId(userId), providerId: platform }, { sort: { _id: -1 } });

    if (!account || !account.accessToken) {
      return { platform, success: false, error: 'no_account' };
    }

    // Shared sync used on both sides of the profile/account binding: the
    // account creation hook already runs it during the OAuth callback, so the
    // username is usually cached and no extra provider call is needed here.
    const profile = await getCachedOAuthProfile(platform, String(account.accountId ?? ''));
    const synced = await syncVerifiedSocialLinkFromAccount(
      userId,
      platform,
      account.accessToken,
      profile?.username
    );
    if (!synced) {
      return { platform, success: false, error: 'resolve_failed' };
    }

    // Read the canonical username back from the link written above.
    const user = await db
      .collection('users')
      .findOne({ _id: new ObjectId(userId) }, { projection: { socialLinks: 1 } });
    const link = (user?.socialLinks as SocialLinkInput[] | undefined)?.find(
      (item) => item.platform === platform
    );

    return { platform, success: true, username: link?.username };
  } catch (err) {
    console.error('Error verifying social link:', err);
    return { platform, success: false, error: 'error' };
  }
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { user } = await parent();

  if (!user) {
    error(401, m.unauthorized());
  }

  // Handle landing back after an OAuth "verify" link flow (writes to the DB,
  // so it must run before the fresh socialLinks read below)
  let verifyResult: SocialVerifyResult | null = null;
  const verifyPlatform = url.searchParams.get('verify');
  if (
    verifyPlatform &&
    (VERIFIABLE_SOCIAL_PLATFORMS as readonly string[]).includes(verifyPlatform)
  ) {
    verifyResult = await handleOAuthVerification(user.id, verifyPlatform);
  } else {
    const verifyErrorPlatform = url.searchParams.get('verifyError');
    if (verifyErrorPlatform) {
      verifyResult = { platform: verifyErrorPlatform, success: false, error: 'cancelled' };
    }
  }

  // Read socialLinks fresh from the DB — the session user snapshot can be stale
  // (better-auth stores the user in the session record at creation time).
  const db = mongo.db();
  const dbUser = await db
    .collection('users')
    .findOne({ _id: new ObjectId(user.id) }, { projection: { socialLinks: 1 } });
  const socialLinks = Array.isArray(dbUser?.socialLinks)
    ? (dbUser.socialLinks as SocialLinkInput[])
    : (user.socialLinks as SocialLinkInput[]) || [];

  const qbindGroups = parseQbindGroups(env.QBIND_GROUPS);

  return {
    userProfile: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      bio: user.bio,
      displayName: user.displayName,
      userType: user.userType,
      isEmailPublic: user.isEmailPublic,
      isActivityPublic: user.isActivityPublic,
      isFootprintPublic: user.isFootprintPublic,
      isUniversityPublic: user.isUniversityPublic,
      isFrequentingArcadePublic: user.isFrequentingArcadePublic,
      isStarredArcadePublic: user.isStarredArcadePublic,
      notificationTypes: user.notificationTypes,
      socialLinks
    },
    qbindToken: nanoid(32),
    qbindGroups,
    verifyResult
  };
};

export const actions: Actions = {
  updateProfile: async ({ request, locals }) => {
    const session = locals.session;
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized(), fieldErrors: {} });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const displayName = formData.get('displayName') as string;
      const bio = formData.get('bio') as string;
      const username = formData.get('username') as string;
      const isEmailPublic = formData.get('isEmailPublic') === 'on';
      const isActivityPublic = formData.get('isActivityPublic') === 'on';
      const isFootprintPublic = formData.get('isFootprintPublic') === 'on';
      const isUniversityPublic = formData.get('isUniversityPublic') === 'on';
      const isFrequentingArcadePublic = formData.get('isFrequentingArcadePublic') === 'on';
      const isStarredArcadePublic = formData.get('isStarredArcadePublic') === 'on';

      // Parse notification settings
      const notificationTypes: NotificationType[] = [];
      if (formData.get('notificationTypeComments') === 'on') notificationTypes.push('COMMENTS');
      if (formData.get('notificationTypeReplies') === 'on') notificationTypes.push('REPLIES');
      if (formData.get('notificationTypePostVotes') === 'on') notificationTypes.push('POST_VOTES');
      if (formData.get('notificationTypeCommentVotes') === 'on')
        notificationTypes.push('COMMENT_VOTES');
      if (formData.get('notificationTypeJoinRequests') === 'on')
        notificationTypes.push('JOIN_REQUESTS');

      // Parse social links
      const socialLinks: Array<{
        platform: SocialPlatform;
        username: string;
      }> = [];
      const platforms = ['qq', 'wechat', 'github', 'discord', 'divingfish'] as const;

      // Extract social links from form data
      for (const entry of formData.entries()) {
        const [key, value] = entry;
        const match = key.match(/^socialLinks\[(\d+)\]\.(platform|username)$/);
        if (match) {
          const index = parseInt(match[1]);
          const field = match[2] as 'platform' | 'username';

          // Ensure the socialLinks array is large enough
          while (socialLinks.length <= index) {
            socialLinks.push({ platform: 'qq', username: '' });
          }

          if (field === 'platform' && platforms.includes(value as (typeof platforms)[number])) {
            socialLinks[index].platform = value as (typeof platforms)[number];
          } else if (field === 'username' && typeof value === 'string') {
            socialLinks[index].username = value.trim();
          }
        }
      }

      // Filter out empty social links
      const validSocialLinks = socialLinks.filter((link) => link.username.trim() !== '');

      const parsedForm = profileSettingsFormSchema.safeParse({
        displayName,
        bio,
        username,
        isEmailPublic,
        isActivityPublic,
        isFootprintPublic,
        isUniversityPublic,
        isFrequentingArcadePublic,
        isStarredArcadePublic,
        notificationTypes,
        socialLinks: validSocialLinks
      });

      // Field-specific validation errors
      const fieldErrors: Record<string, string> = {};

      if (!parsedForm.success) {
        for (const issue of parsedForm.error.issues) {
          const field = issue.path[0];
          if (typeof field === 'string') {
            fieldErrors[field] = issue.message;
          }
        }
      }

      // If there are validation errors, return them
      if (Object.keys(fieldErrors).length > 0) {
        return fail(400, {
          message: 'validation_error',
          fieldErrors,
          formData: {
            displayName,
            bio,
            username,
            isEmailPublic,
            isActivityPublic,
            isFootprintPublic,
            isUniversityPublic,
            isFrequentingArcadePublic,
            isStarredArcadePublic,
            notificationTypes,
            socialLinks: validSocialLinks
          }
        });
      }

      // Check if username is taken (if username changed)
      if (username && username.trim() !== user.name) {
        const db = mongo.db();
        const usersCollection = db.collection('users');

        const existingUser = await usersCollection.findOne({
          name: username.trim(),
          _id: { $ne: new ObjectId(user.id) }
        });

        if (existingUser) {
          return fail(400, {
            message: 'username_taken',
            fieldErrors: { username: 'username_taken' },
            formData: {
              displayName,
              bio,
              username,
              isEmailPublic,
              isActivityPublic,
              isFootprintPublic,
              isUniversityPublic,
              isFrequentingArcadePublic,
              isStarredArcadePublic,
              notificationTypes,
              socialLinks: validSocialLinks
            }
          });
        }
      }

      const db = mongo.db();
      const usersCollection = db.collection('users');

      // Carry over the `verified` flag only for links whose username is unchanged
      const currentUser = await usersCollection.findOne(
        { _id: new ObjectId(user.id) },
        { projection: { socialLinks: 1 } }
      );
      const currentLinks = Array.isArray(currentUser?.socialLinks)
        ? (currentUser.socialLinks as SocialLinkInput[])
        : [];
      const currentByKey = new Map(
        currentLinks.map((link) => [`${link.platform}:${link.username}`, link])
      );
      const socialLinksWithVerified: SocialLinkInput[] = validSocialLinks.map((link) => ({
        ...link,
        verified: currentByKey.get(`${link.platform}:${link.username}`)?.verified === true
      }));

      const updateData: {
        displayName?: string;
        bio: string;
        isEmailPublic: boolean;
        isActivityPublic: boolean;
        isFootprintPublic: boolean;
        isUniversityPublic: boolean;
        isFrequentingArcadePublic: boolean;
        isStarredArcadePublic: boolean;
        notificationTypes: NotificationType[];
        socialLinks: SocialLinkInput[];
        updatedAt: Date;
        name?: string;
      } = {
        displayName: displayName?.trim() || undefined,
        bio: bio?.trim() || '',
        isEmailPublic,
        isActivityPublic,
        isFootprintPublic,
        isUniversityPublic,
        isFrequentingArcadePublic,
        isStarredArcadePublic,
        notificationTypes,
        socialLinks: socialLinksWithVerified,
        updatedAt: new Date()
      };

      // Only update username if it's different
      if (username && username.trim() !== user.name) {
        updateData.name = username.trim();
      }

      await usersCollection.updateOne({ _id: new ObjectId(user.id) }, { $set: updateData });

      return { success: true };
    } catch (err) {
      console.error('Error updating profile:', err);
      return fail(500, {
        message: 'profile_update_error',
        fieldErrors: {}
      });
    }
  }
};

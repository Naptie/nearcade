import { fail } from '@sveltejs/kit';
import { ObjectId } from 'mongodb';
import type { PageServerLoad, Actions } from './$types';
import mongo from '$lib/db/index.server';
import type { NotificationType } from '$lib/types';

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();

  if (!user) {
    return fail(401, { message: 'Unauthorized' });
  }

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
      socialLinks: user.socialLinks || []
    }
  };
};

export const actions: Actions = {
  updateProfile: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized', fieldErrors: {} });
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
        platform: 'qq' | 'wechat' | 'github' | 'discord';
        username: string;
      }> = [];
      const platforms = ['qq', 'wechat', 'github', 'discord'] as const;

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

      // Field-specific validation errors
      const fieldErrors: Record<string, string> = {};

      // Validate username
      if (!username || username.trim() === '') {
        fieldErrors.username = 'username_required';
      } else if (username.trim().length > 30) {
        fieldErrors.username = 'username_too_long';
      } else if (!/^[A-Za-z0-9_-]+$/.test(username.trim())) {
        fieldErrors.username = 'username_invalid';
      }

      // Validate display name
      if (displayName && displayName.trim().length > 50) {
        fieldErrors.displayName = 'display_name_too_long';
      }

      // Validate bio
      if (bio && bio.trim().length > 500) {
        fieldErrors.bio = 'bio_too_long';
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
        socialLinks: Array<{ platform: 'qq' | 'wechat' | 'github' | 'discord'; username: string }>;
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
        socialLinks: validSocialLinks,
        updatedAt: new Date()
      };

      // Only update username if it's different
      if (username && username.trim() !== user.name) {
        updateData.name = username.trim();
      }

      await usersCollection.updateOne({ _id: new ObjectId(user.id) }, { $set: updateData });

      return { success: true, message: 'profile_updated' };
    } catch (err) {
      console.error('Error updating profile:', err);
      return fail(500, {
        message: 'profile_update_error',
        fieldErrors: {}
      });
    }
  }
};

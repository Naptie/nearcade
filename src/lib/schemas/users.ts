import { PAGINATION } from '$lib/constants';
import { z } from 'zod';

import { organizationChangelogEntrySchema } from './organizations';
import { shopDeleteRequestVoteTypeSchema, shopSchema } from './shops';
import {
  bilingual,
  dateTimeSchema,
  objectIdSchema,
  socialLinkSchema,
  successResponseSchema,
  userIdSchema,
  userPublicSchema,
  userSchema
} from './common';
import { commentVoteTypeSchema } from './comments';
import { imageUploadEventSchema, imageUploadRequestSchema } from './images';

const positiveIntegerQueryParamSchema = (
  description: string,
  defaultValue: number,
  maximum = Number.MAX_SAFE_INTEGER
) =>
  z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) =>
      value === null || value === undefined || value === '' ? defaultValue : Number(value)
    )
    .pipe(z.number().int().min(1).max(maximum))
    .describe(description);

export const userRouteIdSchema = z
  .string()
  .min(1)
  .describe(
    bilingual('用户 ID，或以 `@` 开头的用户名。', 'User ID, or a username prefixed with `@`.')
  );

export const userRouteIdParamSchema = z.object({
  id: userRouteIdSchema
});

export const userActivitiesQuerySchema = z.object({
  page: positiveIntegerQueryParamSchema(
    bilingual('页数。默认为 1。', 'Page number. Defaults to 1.'),
    1
  ),
  limit: positiveIntegerQueryParamSchema(
    bilingual(
      '每页返回的活动条目数量。默认为站点分页大小，最大为 100。',
      'Number of activities per page. Defaults to the site page size, up to 100.'
    ),
    PAGINATION.PAGE_SIZE,
    100
  )
});

const activityTypeSchema = z
  .enum([
    'post',
    'comment',
    'reply',
    'shop_comment',
    'shop_reply',
    'post_vote',
    'comment_vote',
    'shop_comment_vote',
    'shop_delete_request_comment',
    'shop_delete_request_reply',
    'shop_delete_request_comment_vote',
    'shop_delete_request_vote',
    'changelog',
    'university_join',
    'club_join',
    'club_create',
    'shop_attendance'
  ])
  .describe(bilingual('活动类型。', 'Activity type.'));

const activityTargetTypeSchema = z
  .enum([
    'post',
    'comment',
    'reply',
    'shop_comment',
    'shop_reply',
    'shop_delete_request',
    'shop_delete_request_comment',
    'shop_delete_request_reply'
  ])
  .describe(bilingual('活动目标类型。', 'Activity target type.'));

export const activitySchema = z
  .object({
    _id: z
      .union([z.string(), objectIdSchema])
      .optional()
      .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: z.string().describe(bilingual('活动 ID。', 'Activity ID.')),
    type: activityTypeSchema,
    createdAt: dateTimeSchema(bilingual('活动时间。', 'Activity time.')),
    userId: userIdSchema,
    postTitle: z.string().optional().describe(bilingual('帖子标题。', 'Post title.')),
    postId: z.string().optional().describe(bilingual('帖子 ID。', 'Post ID.')),
    universityId: z.string().optional().describe(bilingual('大学 ID。', 'University ID.')),
    clubId: z.string().optional().describe(bilingual('社团 ID。', 'Club ID.')),
    universityName: z.string().optional().describe(bilingual('大学名称。', 'University name.')),
    clubName: z.string().optional().describe(bilingual('社团名称。', 'Club name.')),
    commentContent: z.string().optional().describe(bilingual('评论内容。', 'Comment content.')),
    commentId: z.string().optional().describe(bilingual('评论 ID。', 'Comment ID.')),
    parentCommentId: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('父评论 ID。', 'Parent comment ID.')),
    parentPostTitle: z
      .string()
      .optional()
      .describe(bilingual('父帖子标题。', 'Parent post title.')),
    voteType: commentVoteTypeSchema.optional(),
    targetType: activityTargetTypeSchema.optional(),
    targetTitle: z.string().optional().describe(bilingual('目标标题。', 'Target title.')),
    targetAuthorName: z
      .string()
      .optional()
      .describe(bilingual('目标作者用户名。', 'Target author username.')),
    targetAuthorDisplayName: z
      .string()
      .optional()
      .describe(bilingual('目标作者显示名称。', 'Target author display name.')),
    targetId: z.string().optional().describe(bilingual('目标 ID。', 'Target ID.')),
    changelogAction: z.string().optional().describe(bilingual('变更动作。', 'Changelog action.')),
    changelogDescription: z
      .string()
      .optional()
      .describe(bilingual('变更描述。', 'Changelog description.')),
    changelogTargetName: z
      .string()
      .optional()
      .describe(bilingual('变更目标名称。', 'Changelog target name.')),
    changelogTargetId: z
      .string()
      .optional()
      .describe(bilingual('变更目标 ID。', 'Changelog target ID.')),
    changelogEntry: organizationChangelogEntrySchema.optional()
      .describe(bilingual('完整变更记录。', 'Full changelog entry.'))
      .meta({ override: { type: 'object', additionalProperties: true } }),
    joinedUniversityId: z
      .string()
      .optional()
      .describe(bilingual('加入的大学 ID。', 'Joined university ID.')),
    joinedUniversityName: z
      .string()
      .optional()
      .describe(bilingual('加入的大学名称。', 'Joined university name.')),
    joinedClubId: z.string().optional().describe(bilingual('加入的社团 ID。', 'Joined club ID.')),
    joinedClubName: z
      .string()
      .optional()
      .describe(bilingual('加入的社团名称。', 'Joined club name.')),
    createdClubId: z.string().optional().describe(bilingual('创建的社团 ID。', 'Created club ID.')),
    createdClubName: z
      .string()
      .optional()
      .describe(bilingual('创建的社团名称。', 'Created club name.')),
    shopId: z.int().optional().describe(bilingual('店铺 ID。', 'Shop ID.')),
    shopName: z.string().optional().describe(bilingual('店铺名称。', 'Shop name.')),
    leaveAt: dateTimeSchema(bilingual('离开时间。', 'Leave time.')).optional(),
    attendanceGames: z
      .string()
      .optional()
      .describe(bilingual('在勤游戏列表。', 'Attendance game list.')),
    isLive: z
      .boolean()
      .optional()
      .describe(bilingual('是否仍在进行中。', 'Whether the activity is still live.')),
    shopDeleteRequestId: z
      .string()
      .optional()
      .describe(bilingual('删除申请 ID。', 'Delete request ID.')),
    shopDeleteRequestType: z
      .enum(['shop', 'photo'])
      .optional()
      .describe(bilingual('删除申请类型。', 'Delete request type.')),
    shopDeleteRequestVoteType: shopDeleteRequestVoteTypeSchema.optional()
  })
  .describe(bilingual('用户活动。', 'User activity.'));

export const userActivitiesResponseSchema = z.object({
  activities: z.array(activitySchema).describe(bilingual('活动列表。', 'Activity list.')),
  hasMore: z.boolean().describe(bilingual('是否还有更多活动。', 'Whether more activities exist.')),
  page: z.int().min(1).describe(bilingual('当前页。', 'Current page.')),
  limit: z.int().min(1).max(100).describe(bilingual('每页条目数。', 'Items per page.'))
});

const userProfileUniversitySchema = z.object({
  id: z.string().describe(bilingual('大学 ID。', 'University ID.')),
  slug: z.string().optional().describe(bilingual('大学 slug。', 'University slug.')),
  name: z.string().describe(bilingual('大学名称。', 'University name.'))
});

export const userUniversityMembershipSummarySchema = z.object({
  verifiedAt: dateTimeSchema(bilingual('认证时间。', 'Verification time.')).optional(),
  joinedAt: dateTimeSchema(bilingual('加入时间。', 'Join time.')),
  university: userProfileUniversitySchema.describe(bilingual('大学摘要。', 'University summary.'))
});

const userProfileUserSchema = userPublicSchema
  .pick({
    id: true,
    name: true,
    displayName: true,
    image: true,
    bio: true,
    userType: true,
    joinedAt: true,
    lastActiveAt: true
  })
  .extend({
    email: z
      .string()
      .nullable()
      .describe(
        bilingual(
          '邮箱；当用户未公开邮箱且当前查看者无权限时为 null。',
          'Email address, or null when it is private to the current viewer.'
        )
      ),
    frequentingArcades: z
      .array(shopSchema)
      .describe(bilingual('常去机厅列表。', 'Frequently visited arcades.')),
    starredArcades: z.array(shopSchema).describe(bilingual('收藏机厅列表。', 'Starred arcades.')),
    isActivityPublic: userSchema.shape.isActivityPublic,
    socialLinks: z.array(socialLinkSchema).describe(bilingual('社交链接。', 'Public social links.'))
  })
  .describe(bilingual('用户资料摘要。', 'User profile summary.'));

export const userProfileResponseSchema = z.object({
  user: userProfileUserSchema,
  frequentingArcadesCount: z
    .int()
    .min(0)
    .describe(bilingual('常去机厅数量。', 'Frequently visited arcade count.')),
  starredArcadesCount: z
    .int()
    .min(0)
    .describe(bilingual('收藏机厅数量。', 'Starred arcade count.')),
  universityMembershipCount: z
    .int()
    .min(0)
    .describe(bilingual('大学成员关系数量。', 'University membership count.')),
  clubMembershipCount: z
    .int()
    .min(0)
    .describe(bilingual('社团成员关系数量。', 'Club membership count.')),
  universityMembership: userUniversityMembershipSummarySchema
    .nullable()
    .describe(bilingual('最近的大学成员关系。', 'Most recent university membership.')),
  isOwnProfile: z
    .boolean()
    .describe(bilingual('是否是当前用户本人。', 'Whether this is the current user.'))
});

export const avatarUploadRequestSchema = imageUploadRequestSchema.pick({ file: true });

export const avatarUploadResponseSchema = imageUploadEventSchema;

export const userProfileDeleteResponseSchema = successResponseSchema;

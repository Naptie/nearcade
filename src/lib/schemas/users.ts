import { PAGINATION } from '$lib/constants';
import { z } from 'zod';
import { getTimezoneOffset } from 'date-fns-tz';

import { organizationChangelogEntrySchema } from './organizations';
import { shopApiSchema, shopChangelogEntrySchema, shopDeleteRequestVoteTypeSchema } from './shops';
import {
  bilingual,
  dateTimeSchema,
  objectIdSchema,
  positiveIntegerQueryParamSchema,
  positiveIntegerString,
  socialLinkSchema,
  successResponseSchema,
  userIdSchema,
  userPublicSchema,
  userSchema
} from './common';
import { commentVoteTypeSchema } from './comments';
import { imageUploadEventSchema, imageUploadRequestSchema } from './images';

export const userRouteIdSchema = z
  .string()
  .min(1)
  .describe(
    bilingual('用户 ID，或以 `@` 开头的用户名。', 'User ID, or a username prefixed with `@`.')
  );

export const userRouteIdParamSchema = z.object({
  id: userRouteIdSchema
});

const activityDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format, expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), {
    message: 'Invalid calendar date'
  })
  .describe(bilingual('日期，格式为 YYYY-MM-DD。', 'Calendar date as YYYY-MM-DD.'));

const timezoneSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(getTimezoneOffset(value)), {
    message: 'Unknown IANA timezone'
  })
  .describe(bilingual('IANA 时区名称。', 'IANA timezone name.'));

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
  ),
  from: activityDaySchema
    .optional()
    .describe(
      bilingual(
        '起始日期（含），格式为 YYYY-MM-DD。提供时按日期范围过滤活动。',
        'Start date (inclusive) as YYYY-MM-DD. When provided, activities are filtered to the date range.'
      )
    ),
  to: activityDaySchema
    .optional()
    .describe(
      bilingual(
        '结束日期（含），格式为 YYYY-MM-DD。提供时按日期范围过滤活动。',
        'End date (inclusive) as YYYY-MM-DD. When provided, activities are filtered to the date range.'
      )
    ),
  types: z
    .string()
    .optional()
    .describe(
      bilingual(
        '逗号分隔的活动类型列表，仅返回这些类型的活动。',
        'Comma-separated activity types; only activities of these types are returned.'
      )
    )
    .transform((value, ctx) => {
      // Absent param stays undefined — an empty array would mean "no types
      // wanted" for the feed query and silently blank the response.
      if (value === undefined) return undefined;
      const types = value
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean);
      const parsed = z.array(activityTypeSchema).safeParse(types);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: 'Unknown activity type in `types`.' });
        return z.NEVER;
      }
      return parsed.data.length > 0 ? [...new Set(parsed.data)] : undefined;
    }),
  timezone: timezoneSchema
    .optional()
    .describe(
      bilingual(
        '用于解释日期范围边界的 IANA 时区。默认为 UTC。',
        'IANA timezone used to interpret date range boundaries. Defaults to UTC.'
      )
    )
});

export const activityTypeSchema = z
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
    'shop_changelog',
    'university_join',
    'club_join',
    'club_create',
    'attendance_report',
    'shop_attendance'
  ])
  .describe(bilingual('活动类型。', 'Activity type.'));

export type ActivityType = z.infer<typeof activityTypeSchema>;

export const activityHeatmapQuerySchema = z.object({
  from: activityDaySchema
    .optional()
    .describe(
      bilingual(
        '起始日期（含），格式为 YYYY-MM-DD。默认为今天往前推 12 个月。',
        'Start date (inclusive) as YYYY-MM-DD. Defaults to 12 months before today.'
      )
    ),
  to: activityDaySchema
    .optional()
    .describe(
      bilingual(
        '结束日期（含），格式为 YYYY-MM-DD。默认为今天。范围最长 400 天。',
        'End date (inclusive) as YYYY-MM-DD. Defaults to today. Range is capped at 400 days.'
      )
    ),
  timezone: timezoneSchema
    .optional()
    .describe(
      bilingual(
        '用于将活动按天分组的 IANA 时区。默认为 UTC。',
        'IANA timezone used to group activities into days. Defaults to UTC.'
      )
    )
});

export const activityHeatmapDaySchema = z.object({
  date: activityDaySchema.describe(
    bilingual('日期，格式为 YYYY-MM-DD。', 'Calendar date as YYYY-MM-DD.')
  ),
  total: z.int().min(0).describe(bilingual('当日活动总数。', 'Total activity count for the day.')),
  byType: z
    .partialRecord(activityTypeSchema, z.int().min(0))
    .describe(bilingual('按活动类型的当日计数。', 'Per-activity-type counts for the day.'))
});

export const activityHeatmapResponseSchema = z.object({
  days: z
    .array(activityHeatmapDaySchema)
    .describe(bilingual('有活动的日期及其计数。', 'Days that have activity, with counts.')),
  total: z
    .int()
    .min(0)
    .describe(bilingual('范围内活动总数。', 'Total activity count in the range.')),
  from: activityDaySchema.describe(
    bilingual('实际使用的起始日期。', 'The start date actually used.')
  ),
  to: activityDaySchema.describe(bilingual('实际使用的结束日期。', 'The end date actually used.')),
  timezone: timezoneSchema.describe(bilingual('实际使用的时区。', 'The timezone actually used.'))
});

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
    changelogEntry: organizationChangelogEntrySchema
      .optional()
      .describe(bilingual('完整变更记录。', 'Full changelog entry.'))
      .meta({ override: { type: 'object', additionalProperties: true } }),
    shopChangelogEntry: shopChangelogEntrySchema
      .optional()
      .describe(bilingual('完整店铺变更记录。', 'Full shop changelog entry.'))
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
    shopDeleteRequestVoteType: shopDeleteRequestVoteTypeSchema.optional(),
    attendanceReportTotal: z
      .int()
      .min(0)
      .optional()
      .describe(bilingual('上报的总在勤人数。', 'Total reported attendance across games.')),
    attendanceReportGames: z
      .array(
        z.object({
          gameId: z.int().describe(bilingual('游戏 ID。', 'Game ID.')),
          name: z.string().describe(bilingual('游戏名称。', 'Game name.')),
          currentAttendances: z
            .int()
            .min(0)
            .describe(bilingual('该游戏的上报在勤人数。', 'Reported attendance for this game.'))
        })
      )
      .optional()
      .describe(bilingual('各游戏的上报人数。', 'Per-game reported attendance.'))
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
      .array(shopApiSchema)
      .describe(bilingual('常去机厅列表。', 'Frequently visited arcades.')),
    starredArcades: z
      .array(shopApiSchema)
      .describe(bilingual('收藏机厅列表。', 'Starred arcades.')),
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

export const usersLookupQuerySchema = z.object({
  qq: z
    .string()
    .regex(/^\d{5,12}$/)
    .optional()
    .describe(
      bilingual(
        '按已验证的 QQ 号查找。至少提供一个查询参数。',
        'Look up by verified QQ number. Provide at least one lookup parameter.'
      )
    ),
  shopId: positiveIntegerString
    .optional()
    .describe(
      bilingual(
        '店铺 ID（机台密钥鉴权时必须提供）。',
        'Shop ID (required for machine secret auth).'
      )
    )
});

export const usersLookupResponseSchema = z.object({
  users: z
    .array(userPublicSchema)
    .describe(bilingual('匹配到的用户列表（公开字段）。', 'Matched users (public fields).'))
});

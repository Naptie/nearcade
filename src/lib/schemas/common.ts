import type { ObjectId } from 'mongodb';
import { z } from 'zod';

import { SOCIAL_PLATFORMS, USER_TYPES } from '../constants';

export const bilingual = (chinese: string, english: string, singleLine = false) =>
  singleLine ? `${chinese} / ${english}` : [chinese, english].join('\n\n');

export const numericString = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .pipe(z.number());

export const integerString = numericString.pipe(z.int());

export const positiveIntegerString = integerString.pipe(z.int().positive());

export const shopIdParamSchema = z.object({
  id: positiveIntegerString.describe(bilingual('店铺 ID。', 'Shop ID.'))
});

export const optionalBooleanString = z
  .union([z.boolean(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
    if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
    return value;
  })
  .pipe(z.union([z.boolean(), z.undefined()]));

export const paginationQuerySchema = z.object({
  page: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
      const parsed = value === null || value === undefined || value === '' ? 1 : Number(value);
      return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 1;
    })
    .describe(bilingual('页数。默认为 1。', 'Page number. Defaults to 1.')),
  limit: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
      const parsed = value === null || value === undefined || value === '' ? 0 : Number(value);
      return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    })
    .describe(
      bilingual(
        '每页条目数。默认为站点分页大小。',
        'Items per page. Defaults to the site page size.'
      )
    )
});

export const openingHourTimeSchema = z.object({
  hour: z
    .number()
    .transform((value) => Math.max(0, Math.min(23, Math.floor(value))))
    .describe(bilingual('24 小时制本地小时。', 'Hour in 24-hour local time.'))
    .meta({ override: { type: 'integer', minimum: 0, maximum: 23 } }),
  minute: z
    .number()
    .transform((value) => Math.max(0, Math.min(59, Math.floor(value))))
    .describe(bilingual('分钟。', 'Minute.'))
    .meta({ override: { type: 'integer', minimum: 0, maximum: 59 } })
});

export const openingHoursSchema = z
  .array(z.tuple([openingHourTimeSchema, openingHourTimeSchema]))
  .min(1)
  .describe(
    bilingual(
      '营业时间。仅有 1 个元素时表示整周均为该营业时间；有 7 个元素时每个元素分别代表一周中的一天。',
      'Opening hours. One item means the same hours for the whole week; seven items map to weekdays.'
    )
  );

export const locationSchema = z.object({
  type: z.literal('Point').describe(bilingual('GeoJSON 几何类型。', 'GeoJSON geometry type.')),
  coordinates: z
    .tuple([
      z.number().min(-180).max(180).describe(bilingual('经度。', 'Longitude.')),
      z.number().min(-90).max(90).describe(bilingual('纬度。', 'Latitude.'))
    ])
    .describe(
      bilingual(
        'GeoJSON 坐标，顺序为 [经度, 纬度]。',
        'GeoJSON coordinates in [longitude, latitude] order.'
      )
    )
});

export const successResponseSchema = z.object({
  success: z.boolean().describe(bilingual('是否成功。', 'Whether the operation succeeded.'))
});

export const errorResponseSchema = z.object({
  error: z.string().optional().describe(bilingual('错误信息。', 'Error message.')),
  message: z.string().optional().describe(bilingual('错误信息。', 'Error message.'))
});

export const userIdSchema = z.string().describe(bilingual('用户 ID。', 'User ID.'));

const NOTIFICATION_TYPES = [
  'COMMENTS',
  'REPLIES',
  'POST_VOTES',
  'COMMENT_VOTES',
  'JOIN_REQUESTS',
  'SHOP_DELETE_REQUESTS'
] as const;

export const objectIdSchema = z
  .custom<ObjectId>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      (value as { constructor?: { name?: string } }).constructor?.name === 'ObjectId'
  )
  .describe(bilingual('MongoDB ObjectId。', 'MongoDB ObjectId.'))
  .meta({ override: { type: 'string' } });

export const dateTimeSchema = (description: string) =>
  z
    .codec(z.iso.datetime(), z.date(), {
      decode: (isoString) => new Date(isoString),
      encode: (date) => date.toISOString()
    })
    .describe(description)
    .meta({ override: { type: 'string', format: 'date-time' } });

export const socialLinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS).describe(bilingual('社交平台。', 'Social platform.')),
  username: z.string().describe(bilingual('用户名。', 'Username.'))
});

const apiTokenSchema = z.object({
  id: z.string().describe(bilingual('API 令牌 ID。', 'API token ID.')),
  name: z.string().describe(bilingual('API 令牌名称。', 'API token name.')),
  token: z.string().describe(bilingual('API 令牌。', 'API token.')),
  shopId: z.int().optional().describe(bilingual('店铺 ID。', 'Shop ID.')),
  expiresAt: dateTimeSchema(bilingual('过期时间。', 'Expiration time.')),
  createdAt: dateTimeSchema(bilingual('创建时间。', 'Creation time.'))
});

export const userPublicSchema = z.object({
  _id: z
    .union([z.string(), objectIdSchema])
    .optional()
    .describe(bilingual('MongoDB ID。客户端请使用 id。', 'MongoDB ID. Use `id` in clients.')),
  id: userIdSchema,
  name: z
    .string()
    .describe(
      bilingual('用户名。展示时请在前面加 @ 符号。', 'Username. Display with an @ prefix.')
    ),
  email: z
    .string()
    .optional()
    .describe(
      bilingual(
        '邮箱，仅在用户勾选“邮箱可见性”时存在。',
        'Email address when the user has made it public.'
      )
    ),
  image: z.string().nullable().optional().describe(bilingual('头像。', 'Avatar URL.')),
  avatarImageId: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('头像图片资源 ID。', 'Avatar image asset ID.')),
  createdAt: dateTimeSchema(bilingual('创建时间。', 'Creation time.')),
  updatedAt: dateTimeSchema(bilingual('资料更新时间。', 'Profile update time.')),
  joinedAt: dateTimeSchema(bilingual('加入时间。', 'Join time.')).optional(),
  lastActiveAt: dateTimeSchema(bilingual('最后活跃时间。', 'Last active time.')).optional(),
  userType: z.enum(USER_TYPES).optional().describe(bilingual('用户类型。', 'User type.')),
  bio: z.string().nullable().optional().describe(bilingual('个人简介。', 'User bio.')),
  displayName: z
    .string()
    .nullable()
    .optional()
    .describe(
      bilingual(
        '用户示名，展示优先级高于 name。',
        'Display name, preferred over `name` when present.'
      )
    ),
  socialLinks: z
    .array(socialLinkSchema)
    .optional()
    .describe(bilingual('社交链接。', 'Social links visible to clients.')),
  frequentingArcades: z
    .array(z.int())
    .optional()
    .describe(
      bilingual(
        '常去机厅，仅在用户勾选“常去机厅可见性”时存在。',
        'Frequently visited arcades when made public.'
      )
    ),
  starredArcades: z
    .array(z.int())
    .optional()
    .describe(
      bilingual(
        '收藏机厅，仅在用户勾选“收藏机厅可见性”时存在。',
        'Starred arcades when made public.'
      )
    )
});

export const userSchema = userPublicSchema.extend({
  emailVerified: z
    .boolean()
    .describe(bilingual('邮箱是否已验证。', 'Whether the email is verified.')),
  notificationReadAt: dateTimeSchema(
    bilingual('通知已读时间。', 'Notification read time.')
  ).optional(),
  autoDiscovery: z
    .object({
      discoveryInteractionThreshold: z
        .number()
        .describe(bilingual('自动发现互动阈值。', 'Auto-discovery interaction threshold.')),
      attendanceThreshold: z
        .number()
        .describe(bilingual('自动发现出勤阈值。', 'Auto-discovery attendance threshold.'))
    })
    .optional()
    .describe(bilingual('自动发现设置。', 'Auto-discovery settings.')),
  isEmailPublic: z
    .boolean()
    .optional()
    .describe(bilingual('邮箱是否公开。', 'Whether the email is public.')),
  isActivityPublic: z
    .boolean()
    .optional()
    .describe(bilingual('活动是否公开。', 'Whether activity is public.')),
  isFootprintPublic: z
    .boolean()
    .optional()
    .describe(bilingual('足迹是否公开。', 'Whether footprints are public.')),
  isUniversityPublic: z
    .boolean()
    .optional()
    .describe(bilingual('学校信息是否公开。', 'Whether university info is public.')),
  isFrequentingArcadePublic: z
    .boolean()
    .optional()
    .describe(bilingual('常去机厅是否公开。', 'Whether frequenting arcades are public.')),
  isStarredArcadePublic: z
    .boolean()
    .optional()
    .describe(bilingual('收藏机厅是否公开。', 'Whether starred arcades are public.')),
  notificationTypes: z
    .array(z.enum(NOTIFICATION_TYPES))
    .optional()
    .describe(bilingual('通知类型。', 'Notification types.')),
  fcmTokens: z.array(z.string()).optional().describe(bilingual('FCM 令牌。', 'FCM tokens.')),
  fcmTokenUpdatedAt: dateTimeSchema(
    bilingual('FCM 令牌更新时间。', 'FCM token update time.')
  ).optional(),
  apiTokens: z.array(apiTokenSchema).optional().describe(bilingual('API 令牌列表。', 'API tokens.'))
});

export const userPrivateFieldNames = Object.keys(userSchema.shape).filter(
  (key) => !(key in userPublicSchema.shape)
);

export const parseSearchParams = <Schema extends z.ZodTypeAny>(schema: Schema, url: URL) => {
  return schema.parse(Object.fromEntries(url.searchParams));
};

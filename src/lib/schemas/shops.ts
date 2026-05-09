import { z } from 'zod';
import {
  bilingual,
  locationSchema,
  openingHoursSchema,
  optionalBooleanString,
  paginationQuerySchema,
  shopIdParamSchema,
  successResponseSchema,
  userIdSchema,
  userPublicSchema
} from './common';

export const shopNameSchema = z.string().describe(bilingual('店铺名称。', 'Shop name.'));
export const shopNameInputSchema = z
  .string()
  .trim()
  .min(1)
  .describe(bilingual('店铺名称。', 'Shop name.'));
const shopCommentSchema = z.string().describe(bilingual('店铺说明。', 'Shop note.'));
const optionalShopCommentSchema = z
  .string()
  .optional()
  .describe(bilingual('店铺说明。', 'Shop note.'));

export const shopIdSchema = z.int().describe(bilingual('店铺 ID。', 'Shop ID.'));

export const gameIdSchema = z
  .int()
  .describe(
    bilingual(
      '游戏（版本）ID；BEMANICN 数据源等同于机台 ID。',
      'Game/version ID. For BEMANICN this equals the machine ID.'
    )
  );
const existingGameIdSchema = z
  .int()
  .optional()
  .describe(
    bilingual('已有游戏 ID，用于更新已知机台。', 'Existing game ID, when updating a known game.')
  );
const gameTitleIdSchema = z.int().describe(bilingual('游戏系列 ID。', 'Game series ID.'));
const gameNameSchema = z.string().describe(bilingual('游戏名。', 'Game name.'));
const gameVersionSchema = z.string().describe(bilingual('游戏版本。', 'Game version.'));
const gameCommentSchema = z.string().default('').describe(bilingual('游戏说明。', 'Game note.'));
const gameQuantitySchema = z
  .int()
  .min(0)
  .default(1)
  .describe(bilingual('机台数量。', 'Number of machines.'));
const gameCostSchema = z.string().default('').describe(bilingual('价格说明。', 'Price note.'));

export const gameAttendanceTotalSchema = z
  .int()
  .min(0)
  .describe(bilingual('机台综合在勤人数。', 'Combined attendance count for this game.'));
const attendanceUserIdSchema = userIdSchema.optional().describe(bilingual('用户 ID。', 'User ID.'));
const attendedAtSchema = z.iso
  .datetime()
  .describe(bilingual('登记在勤时间。', 'Attendance registration time.'));
const plannedLeaveAtSchema = z.iso
  .datetime()
  .describe(bilingual('计划退勤时间。', 'Planned leave time.'));
const optionalPlannedLeaveAtSchema = z.iso
  .datetime()
  .optional()
  .describe(bilingual('计划退勤时间。', 'Planned leave time for attendance registration.'));
export const partialAttendanceUserSchema = userPublicSchema
  .partial()
  .optional()
  .describe(bilingual('关联用户。', 'Associated user when available.'));
export const currentAttendancesSchema = z
  .int()
  .min(0)
  .describe(bilingual('在勤人数。', 'Reported current attendance count.'));
const defaultCurrentAttendancesSchema = z
  .int()
  .optional()
  .default(0)
  .describe(bilingual('在勤人数。', 'Reported current attendance count.'));
export const attendanceReportCommentSchema = z
  .string()
  .nullable()
  .describe(bilingual('上报说明。', 'Attendance report note.'));
const optionalAttendancePostCommentSchema = z
  .string()
  .optional()
  .describe(bilingual('上报说明。', 'Attendance report note.'));
export const reportedBySchema = z.string().describe(bilingual('上报者 ID。', 'Reporter user ID.'));
export const reportedAtSchema = z.iso
  .datetime()
  .describe(bilingual('上报时间。', 'Attendance report time.'));

export const includeTimeInfoSchema = optionalBooleanString
  .default(true)
  .describe(
    bilingual(
      '是否包含时间信息（包括 timezone 与 isOpen）。默认为是。',
      'Include computed timezone and open status. Defaults to true.'
    )
  );
const shopLocationSchema = locationSchema.describe(bilingual('店铺坐标。', 'Shop coordinates.'));
const optionalShopLocationSchema = locationSchema
  .optional()
  .describe(bilingual('店铺坐标。', 'Shop coordinates.'));

export const queueSlotIndexSchema = z.string().min(1).describe(bilingual('槽位。', 'Slot index.'));
const queueMemberUserIdSchema = z
  .string()
  .nullable()
  .describe(
    bilingual(
      '用户 ID；空位或非公开位置可为 null。',
      'User ID in the slot, or null for an empty/private slot.'
    )
  );
const queueMachineNameSchema = z.string().describe(bilingual('机台名。', 'Machine name.'));
const queuePositionNumberSchema = z.int().describe(bilingual('位置。', 'Queue position.'));
const queueIsPublicSchema = z
  .boolean()
  .describe(bilingual('是否为公开位置。', 'Whether this position is public.'));

export const shopAddressSchema = z.object({
  general: z
    .array(z.string())
    .default([])
    .describe(
      bilingual(
        '大致地址，一般为：[国家/地区, 省, 市, 区]。',
        'General address, usually [country/region, province, city, district].'
      )
    ),
  detailed: z.string().default('').describe(bilingual('详细地址。', 'Detailed street address.'))
});

export const gameSchema = z.object({
  gameId: gameIdSchema,
  titleId: gameTitleIdSchema,
  name: gameNameSchema,
  version: gameVersionSchema,
  comment: gameCommentSchema,
  quantity: gameQuantitySchema,
  cost: gameCostSchema
});

export const gameCreateSchema = gameSchema.omit({ gameId: true });

export const gameUpdateInputSchema = gameCreateSchema.extend({
  gameId: existingGameIdSchema
});

export const attendanceGameSchema = gameSchema.extend({
  total: gameAttendanceTotalSchema
});

export const attendanceRegisteredEntrySchema = z.object({
  userId: attendanceUserIdSchema,
  gameId: gameIdSchema,
  attendedAt: attendedAtSchema,
  plannedLeaveAt: plannedLeaveAtSchema,
  user: partialAttendanceUserSchema
});

export const attendanceReportedEntrySchema = z.object({
  gameId: gameIdSchema,
  currentAttendances: defaultCurrentAttendancesSchema,
  comment: attendanceReportCommentSchema,
  reportedBy: reportedBySchema,
  reportedAt: reportedAtSchema,
  reporter: partialAttendanceUserSchema
});

export const shopSchema = z.object({
  _id: z.string().describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
  id: shopIdSchema,
  name: shopNameSchema,
  comment: shopCommentSchema,
  address: shopAddressSchema.describe(bilingual('店铺地址。', 'Shop address.')),
  openingHours: openingHoursSchema,
  games: z.array(gameSchema).describe(bilingual('机台。', 'Machines/games available at the shop.')),
  location: shopLocationSchema,
  timezone: z
    .object({
      name: z.string().describe(bilingual('时区名称。', 'Timezone name.')),
      offset: z.number().describe(bilingual('时区偏移，单位：小时。', 'Timezone offset in hours.'))
    })
    .optional()
    .describe(bilingual('店铺时区。', 'Computed shop timezone.')),
  isOpen: z
    .boolean()
    .optional()
    .describe(bilingual('店铺营业状态。', 'Whether the shop is currently open.')),
  isClaimed: z
    .boolean()
    .optional()
    .describe(
      bilingual('店铺是否已被认领。', 'Whether this shop is claimed by a machine/operator.')
    ),
  createdAt: z.iso.datetime().optional().describe(bilingual('创建时间。', 'Creation time.')),
  updatedAt: z.iso.datetime().describe(bilingual('更新时间。', 'Update time.'))
});

export const shopsListQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional().default('').describe(bilingual('查询字符串。', 'Search query string.')),
  includeTimeInfo: includeTimeInfoSchema
});

export const shopDetailQuerySchema = z.object({
  includeTimeInfo: includeTimeInfoSchema
});

export const createShopBodySchema = z.object({
  name: shopNameInputSchema,
  comment: optionalShopCommentSchema.default(''),
  address: shopAddressSchema
    .optional()
    .default({ general: [], detailed: '' })
    .describe(bilingual('店铺地址。', 'Shop address.')),
  openingHours: openingHoursSchema,
  location: shopLocationSchema,
  games: z
    .array(gameCreateSchema)
    .optional()
    .default([])
    .describe(bilingual('机台。', 'Machines/games available at the shop.'))
});

export const updateShopBodySchema = z
  .object({
    name: shopNameInputSchema.optional().describe(bilingual('店铺名称。', 'Shop name.')),
    comment: optionalShopCommentSchema,
    address: shopAddressSchema.optional().describe(bilingual('店铺地址。', 'Shop address.')),
    openingHours: openingHoursSchema.optional(),
    location: optionalShopLocationSchema,
    games: z
      .array(gameUpdateInputSchema)
      .optional()
      .describe(bilingual('机台。', 'Machines/games available at the shop.'))
  })
  .refine((value) => Object.keys(value).length > 0, 'No fields to update');

export const shopsListResponseSchema = z.object({
  shops: z.array(shopSchema).describe(bilingual('店铺列表。', 'Shop list.')),
  totalCount: z.int().describe(bilingual('总数。', 'Total count.')),
  currentPage: z.int().describe(bilingual('当前页。', 'Current page.')),
  hasNextPage: z.boolean().describe(bilingual('是否有下一页。', 'Whether there is a next page.')),
  hasPrevPage: z
    .boolean()
    .describe(bilingual('是否有上一页。', 'Whether there is a previous page.'))
});

export const shopResponseSchema = z.object({
  shop: shopSchema.describe(bilingual('店铺详情。', 'Shop details.'))
});

export const shopSummarySchema = z
  .object({
    id: shopIdSchema,
    name: shopNameSchema
  })
  .describe(bilingual('店铺摘要。', 'Shop summary.'));

export const attendanceGameRequestSchema = z.object({
  id: gameIdSchema,
  currentAttendances: currentAttendancesSchema
    .optional()
    .describe(bilingual('在勤人数。', 'Reported current attendance count.')),
  attend: z
    .boolean()
    .optional()
    .describe(
      bilingual(
        '代表用户操作时，登记或移除该用户的在勤。',
        'When acting on behalf of a user, register or remove that user from attendance.'
      )
    )
});

export const attendancePostBodySchema = z.object({
  games: z
    .array(attendanceGameRequestSchema)
    .min(1)
    .describe(bilingual('在勤操作的游戏列表。', 'Games included in the attendance operation.')),
  plannedLeaveAt: optionalPlannedLeaveAtSchema,
  comment: optionalAttendancePostCommentSchema
});

export const attendanceQuerySchema = z.object({
  reported: z
    .string()
    .optional()
    .describe(
      bilingual(
        '是否仅获取登记 (false) / 上报 (true) 的在勤人数。',
        'Whether to fetch only registered (`false`) or reported (`true`) attendance records.'
      )
    )
});

export const attendanceResponseSchema = successResponseSchema.extend({
  total: z
    .int()
    .describe(
      bilingual(
        '综合在勤人数，结合登记与上报人数综合计算得出。',
        'Combined attendance count from registered and reported data.'
      )
    ),
  games: z
    .array(attendanceGameSchema)
    .describe(bilingual('按游戏汇总的在勤数据。', 'Attendance data grouped by game.')),
  registered: z
    .array(attendanceRegisteredEntrySchema)
    .describe(bilingual('登记在勤列表。', 'Registered attendance entries.')),
  reported: z
    .array(attendanceReportedEntrySchema)
    .describe(bilingual('上报在勤列表。', 'Reported attendance entries.'))
});

export type AttendanceResponse = z.infer<typeof attendanceResponseSchema>;

export const queueStatusSchema = z.enum(['playing', 'queued', 'deferred']);

export const queueMemberSchema = z.object({
  slotIndex: queueSlotIndexSchema,
  userId: queueMemberUserIdSchema
});

export const queuePositionSchema = z.object({
  machineName: queueMachineNameSchema,
  position: queuePositionNumberSchema,
  isPublic: queueIsPublicSchema,
  status: queueStatusSchema.describe(bilingual('状态。', 'Queue status.')),
  members: z
    .array(queueMemberSchema)
    .describe(bilingual('成员列表。', 'Members in this queue position.'))
});

export const queuesPostBodySchema = z.object({
  queues: z
    .array(
      z.object({
        gameId: gameIdSchema,
        queue: z.array(queuePositionSchema).describe(bilingual('队列。', 'Queue positions.'))
      })
    )
    .describe(bilingual('按游戏提交的队列数据。', 'Queue payload grouped by game.'))
    .min(1)
});

export const queueReportResponseSchema = successResponseSchema.extend({
  notificationsQueued: z
    .int()
    .optional()
    .describe(
      bilingual('本次更新加入通知队列的数量。', 'Number of notifications queued by the update.')
    )
});

export const queueViewerUserSchema = z.object({
  id: z.string().describe(bilingual('用户 ID。', 'User ID.')),
  name: z.string().describe(bilingual('用户名。', 'Username.')),
  displayName: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('用户示名。', 'Display name when available.')),
  image: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('头像。', 'Avatar URL when available.'))
});

export const queueMemberWithUserSchema = queueMemberSchema.extend({
  user: queueViewerUserSchema
    .nullable()
    .describe(
      bilingual('公开队列成员对应的用户信息。', 'Resolved user data for a visible queue member.')
    )
});

export const queuePositionWithUsersSchema = queuePositionSchema.extend({
  members: z
    .array(queueMemberWithUserSchema)
    .describe(
      bilingual(
        '该位置的成员列表，包含公开的用户信息。',
        'Members in this queue position, enriched with public user data.'
      )
    )
});

export const queueGameStateSchema = z.object({
  gameId: gameIdSchema,
  queue: z
    .array(queuePositionWithUsersSchema)
    .describe(bilingual('该游戏的队列位置。', 'Queue positions for the game.'))
});

export const queuesListResponseSchema = successResponseSchema.extend({
  queues: z
    .array(queueGameStateSchema)
    .describe(bilingual('店铺当前机台队列数据。', 'Current queue data for the shop.'))
});

export const createShopRequestSchema = createShopBodySchema.meta({ id: 'CreateShopRequest' });
export const shopResponseOpenApiSchema = shopResponseSchema.meta({ id: 'ShopResponse' });
export const shopsListResponseOpenApiSchema = shopsListResponseSchema.meta({
  id: 'ShopsListResponse'
});
export const updateShopRequestSchema = updateShopBodySchema.meta({ id: 'UpdateShopRequest' });
export const attendanceRequestSchema = attendancePostBodySchema.meta({ id: 'AttendanceRequest' });
export const attendanceResponseOpenApiSchema = attendanceResponseSchema.meta({
  id: 'AttendanceResponse'
});
export const queueReportRequestSchema = queuesPostBodySchema.meta({ id: 'QueueReportRequest' });
export const queueReportResponseOpenApiSchema = queueReportResponseSchema.meta({
  id: 'QueueReportResponse'
});
export const queueListResponseOpenApiSchema = queuesListResponseSchema.meta({
  id: 'QueueListResponse'
});

export { shopIdParamSchema };

export type CreateShopBody = z.infer<typeof createShopBodySchema>;
export type UpdateShopBody = z.infer<typeof updateShopBodySchema>;
export type QueueGameDataBody = z.infer<typeof queuesPostBodySchema>['queues'][number];

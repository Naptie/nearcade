import { z } from 'zod';
import {
  bilingual,
  locationSchema,
  openingHoursSchema,
  optionalBooleanString,
  paginationQuerySchema,
  shopIdParamSchema,
  successResponseSchema,
  userPublicSchema
} from './common';

export const shopAddressSchema = z.object({
  general: z
    .array(z.string())
    .default([])
    .describe(
      bilingual('大致地址，一般为：[国家/地区, 省, 市, 区]。', 'General address, usually [country/region, province, city, district].')
    ),
  detailed: z.string().default('').describe(bilingual('详细地址。', 'Detailed street address.'))
});

export const gameSchema = z.object({
  gameId: z
    .int()
    .describe(
      bilingual('游戏（版本）ID；BEMANICN 数据源等同于机台 ID。', 'Game/version ID. For BEMANICN this equals the machine ID.')
    ),
  titleId: z.int().describe(bilingual('游戏系列 ID。', 'Game series ID.')),
  name: z.string().describe(bilingual('游戏名。', 'Game name.')),
  version: z.string().describe(bilingual('游戏版本。', 'Game version.')),
  comment: z.string().default('').describe(bilingual('游戏说明。', 'Game note.')),
  quantity: z
    .number()

    .transform((value) => Math.max(0, Math.floor(value)))
    .default(1)
    .describe(bilingual('机台数量。', 'Number of machines.'))
    .meta({ override: { type: 'integer', minimum: 0 } }),
  cost: z.string().default('').describe(bilingual('价格说明。', 'Price note.'))
});

export const gameCreateSchema = gameSchema.omit({ gameId: true });

export const gameUpdateInputSchema = gameCreateSchema.extend({
  gameId: z
    .int()
    .optional()
    .describe(
      bilingual('已有游戏 ID，用于更新已知机台。', 'Existing game ID, when updating a known game.')
    )
});

export const shopSchema = z.object({
  _id: z.string().describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
  id: z
    .int()
    .describe(
      bilingual('店铺 ID。旧文档中须与 source 结合才能唯一确定店铺；当前 API 路由使用数字 ID。', 'Shop ID. Unique together with the source in legacy docs; current API routes use the numeric ID.')
    ),
  name: z.string().describe(bilingual('店铺名称。', 'Shop name.')),
  comment: z.string().describe(bilingual('店铺说明。', 'Shop note.')),
  address: shopAddressSchema.describe(bilingual('店铺地址。', 'Shop address.')),
  openingHours: openingHoursSchema,
  games: z.array(gameSchema).describe(bilingual('机台。', 'Machines/games available at the shop.')),
  location: locationSchema.describe(bilingual('店铺坐标。', 'Shop coordinates.')),
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
  createdAt: z
    .union([z.string(), z.date()])
    .optional()
    .describe(bilingual('创建时间。', 'Creation time.')),
  updatedAt: z.union([z.string(), z.date()]).describe(bilingual('更新时间。', 'Update time.')),
  source: z
    .string()
    .optional()
    .describe(
      bilingual('店铺来源；当前数据可能不返回该字段。', 'Legacy shop data source when present.')
    )
});

export const shopsListQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional().default('').describe(bilingual('查询字符串。', 'Search query string.')),
  includeTimeInfo: optionalBooleanString
    .default(true)
    .describe(
      bilingual('是否包含时间信息（包括 timezone 与 isOpen）。默认为是。', 'Include computed timezone and open status. Defaults to true.')
    )
});

export const shopDetailQuerySchema = z.object({
  includeTimeInfo: optionalBooleanString
    .default(true)
    .describe(
      bilingual('是否包含时间信息（包括 timezone 与 isOpen）。默认为是。', 'Include computed timezone and open status. Defaults to true.')
    )
});

export const createShopBodySchema = z.object({
  name: z.string().trim().min(1).describe(bilingual('店铺名称。', 'Shop name.')),
  comment: z.string().optional().default('').describe(bilingual('店铺说明。', 'Shop note.')),
  address: shopAddressSchema.optional().default({ general: [], detailed: '' }),
  openingHours: openingHoursSchema,
  location: locationSchema,
  games: z.array(gameCreateSchema).optional().default([])
});

export const updateShopBodySchema = z
  .object({
    name: z.string().trim().min(1).optional().describe(bilingual('店铺名称。', 'Shop name.')),
    comment: z.string().optional().describe(bilingual('店铺说明。', 'Shop note.')),
    address: shopAddressSchema.optional(),
    openingHours: openingHoursSchema.optional(),
    location: locationSchema.optional(),
    games: z.array(gameUpdateInputSchema).optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'No fields to update');

export const shopsListResponseSchema = z.object({
  shops: z.array(shopSchema),
  totalCount: z.int(),
  currentPage: z.int(),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean()
});

export const shopResponseSchema = z.object({ shop: shopSchema });

export const attendanceGameRequestSchema = z.object({
  id: z.int().describe(bilingual('游戏（版本）ID。', 'Game/version ID.')),
  currentAttendances: z
    .int()
    .min(0)
    .optional()
    .describe(bilingual('在勤人数。', 'Reported current attendance count.')),
  attend: z
    .boolean()
    .optional()
    .describe(
      bilingual('代表用户操作时，登记或移除该用户的在勤。', 'When acting on behalf of a user, register or remove that user from attendance.')
    )
});

export const attendancePostBodySchema = z.object({
  games: z.array(attendanceGameRequestSchema).min(1),
  plannedLeaveAt: z
    .string()
    .datetime()
    .optional()
    .describe(bilingual('计划退勤时间。', 'Planned leave time for attendance registration.')),
  comment: z.string().optional().describe(bilingual('上报说明。', 'Attendance report note.'))
});

export const attendanceQuerySchema = z.object({
  reported: z
    .string()
    .optional()
    .describe(
      bilingual('是否仅获取登记 (false) / 上报 (true) 的在勤人数。', 'Whether to fetch only registered (`false`) or reported (`true`) attendance records.')
    )
});

export const attendanceResponseSchema = z.object({
  success: z.boolean(),
  total: z
    .int()
    .describe(
      bilingual('综合在勤人数，结合登记与上报人数综合计算得出。', 'Combined attendance count from registered and reported data.')
    ),
  games: z.array(
    gameSchema.extend({
      total: z
        .int()
        .describe(bilingual('机台综合在勤人数。', 'Combined attendance count for this game.'))
    })
  ),
  registered: z.array(
    z.object({
      userId: z.string().optional(),
      gameId: z.int(),
      attendedAt: z.string(),
      plannedLeaveAt: z.string(),
      user: userPublicSchema.optional()
    })
  ),
  reported: z.array(
    z.object({
      gameId: z.int(),
      currentAttendances: z.int(),
      comment: z.string().nullable(),
      reportedBy: z.string(),
      reportedAt: z.string(),
      reporter: userPublicSchema.optional()
    })
  )
});

export const queueStatusSchema = z.enum(['playing', 'queued', 'deferred']);

export const queueMemberSchema = z.object({
  slotIndex: z.string().min(1).describe(bilingual('槽位。', 'Slot index.')),
  userId: z
    .string()
    .nullable()
    .describe(
      bilingual('用户 ID；空位或非公开位置可为 null。', 'User ID in the slot, or null for an empty/private slot.')
    )
});

export const queuePositionSchema = z.object({
  machineName: z.string().describe(bilingual('机台名。', 'Machine name.')),
  position: z.int().describe(bilingual('位置。', 'Queue position.')),
  isPublic: z.boolean().describe(bilingual('是否为公开位置。', 'Whether this position is public.')),
  status: queueStatusSchema.describe(bilingual('状态。', 'Queue status.')),
  members: z
    .array(queueMemberSchema)
    .describe(bilingual('成员列表。', 'Members in this queue position.'))
});

export const queuesPostBodySchema = z.object({
  queues: z
    .array(
      z.object({
        gameId: z.int().describe(bilingual('游戏（版本）ID。', 'Game/version ID.')),
        queue: z.array(queuePositionSchema).describe(bilingual('队列。', 'Queue positions.'))
      })
    )
    .min(1)
});

export const queuePostResponseSchema = successResponseSchema.extend({
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
      bilingual('该位置的成员列表，包含公开的用户信息。', 'Members in this queue position, enriched with public user data.')
    )
});

export const queueGameStateSchema = z.object({
  gameId: z.int().describe(bilingual('游戏（版本）ID。', 'Game/version ID.')),
  queue: z
    .array(queuePositionWithUsersSchema)
    .describe(bilingual('该游戏的队列位置。', 'Queue positions for the game.'))
});

export const queuesGetResponseSchema = successResponseSchema.extend({
  queues: z
    .array(queueGameStateSchema)
    .describe(bilingual('店铺当前机台队列数据。', 'Current queue data for the shop.'))
});

export { shopIdParamSchema };

export type CreateShopBody = z.infer<typeof createShopBodySchema>;
export type UpdateShopBody = z.infer<typeof updateShopBodySchema>;
export type QueueGameDataBody = z.infer<typeof queuesPostBodySchema>['queues'][number];

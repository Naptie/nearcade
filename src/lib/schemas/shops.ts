import { z } from 'zod';
import {
  multilingual,
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
      multilingual(
        'General address, usually [country/region, province, city, district].',
        '大致地址，一般为：[国家/地区, 省, 市, 区]。'
      )
    ),
  detailed: z.string().default('').describe(multilingual('Detailed street address.', '详细地址。'))
});

export const gameSchema = z.object({
  gameId: z
    .int()
    .describe(
      multilingual(
        'Game/version ID. For BEMANICN this equals the machine ID.',
        '游戏（版本）ID；BEMANICN 数据源等同于机台 ID。'
      )
    ),
  titleId: z.int().describe(multilingual('Game series ID.', '游戏系列 ID。')),
  name: z.string().describe(multilingual('Game name.', '游戏名。')),
  version: z.string().describe(multilingual('Game version.', '游戏版本。')),
  comment: z.string().default('').describe(multilingual('Game note.', '游戏说明。')),
  quantity: z
    .number()

    .transform((value) => Math.max(0, Math.floor(value)))
    .default(1)
    .describe(multilingual('Number of machines.', '机台数量。'))
    .meta({ override: { type: 'integer', minimum: 0 } }),
  cost: z.string().default('').describe(multilingual('Price note.', '价格说明。'))
});

export const gameCreateSchema = gameSchema.omit({ gameId: true });

export const gameUpdateInputSchema = gameCreateSchema.extend({
  gameId: z
    .int()
    .optional()
    .describe(
      multilingual('Existing game ID, when updating a known game.', '已有游戏 ID，用于更新已知机台。')
    )
});

export const shopSchema = z.object({
  _id: z.string().describe(multilingual('MongoDB ID.', 'MongoDB ID。')),
  id: z
    .int()
    .describe(
      multilingual(
        'Shop ID. Unique together with the source in legacy docs; current API routes use the numeric ID.',
        '店铺 ID。旧文档中须与 source 结合才能唯一确定店铺；当前 API 路由使用数字 ID。'
      )
    ),
  name: z.string().describe(multilingual('Shop name.', '店铺名称。')),
  comment: z.string().describe(multilingual('Shop note.', '店铺说明。')),
  address: shopAddressSchema.describe(multilingual('Shop address.', '店铺地址。')),
  openingHours: openingHoursSchema,
  games: z.array(gameSchema).describe(multilingual('Machines/games available at the shop.', '机台。')),
  location: locationSchema.describe(multilingual('Shop coordinates.', '店铺坐标。')),
  timezone: z
    .object({
      name: z.string().describe(multilingual('Timezone name.', '时区名称。')),
      offset: z.number().describe(multilingual('Timezone offset in hours.', '时区偏移，单位：小时。'))
    })
    .optional()
    .describe(multilingual('Computed shop timezone.', '店铺时区。')),
  isOpen: z
    .boolean()
    .optional()
    .describe(multilingual('Whether the shop is currently open.', '店铺营业状态。')),
  isClaimed: z
    .boolean()
    .optional()
    .describe(
      multilingual('Whether this shop is claimed by a machine/operator.', '店铺是否已被认领。')
    ),
  createdAt: z
    .union([z.string(), z.date()])
    .optional()
    .describe(multilingual('Creation time.', '创建时间。')),
  updatedAt: z.union([z.string(), z.date()]).describe(multilingual('Update time.', '更新时间。')),
  source: z
    .string()
    .optional()
    .describe(
      multilingual('Legacy shop data source when present.', '店铺来源；当前数据可能不返回该字段。')
    )
});

export const shopsListQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional().default('').describe(multilingual('Search query string.', '查询字符串。')),
  includeTimeInfo: optionalBooleanString
    .default(true)
    .describe(
      multilingual(
        'Include computed timezone and open status. Defaults to true.',
        '是否包含时间信息（包括 timezone 与 isOpen）。默认为是。'
      )
    )
});

export const shopDetailQuerySchema = z.object({
  includeTimeInfo: optionalBooleanString
    .default(true)
    .describe(
      multilingual(
        'Include computed timezone and open status. Defaults to true.',
        '是否包含时间信息（包括 timezone 与 isOpen）。默认为是。'
      )
    )
});

export const createShopBodySchema = z.object({
  name: z.string().trim().min(1).describe(multilingual('Shop name.', '店铺名称。')),
  comment: z.string().optional().default('').describe(multilingual('Shop note.', '店铺说明。')),
  address: shopAddressSchema.optional().default({ general: [], detailed: '' }),
  openingHours: openingHoursSchema,
  location: locationSchema,
  games: z.array(gameCreateSchema).optional().default([])
});

export const updateShopBodySchema = z
  .object({
    name: z.string().trim().min(1).optional().describe(multilingual('Shop name.', '店铺名称。')),
    comment: z.string().optional().describe(multilingual('Shop note.', '店铺说明。')),
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
  id: z.int().describe(multilingual('Game/version ID.', '游戏（版本）ID。')),
  currentAttendances: z
    .int()
    .min(0)
    .optional()
    .describe(multilingual('Reported current attendance count.', '在勤人数。')),
  attend: z
    .boolean()
    .optional()
    .describe(
      multilingual(
        'When acting on behalf of a user, register or remove that user from attendance.',
        '代表用户操作时，登记或移除该用户的在勤。'
      )
    )
});

export const attendancePostBodySchema = z.object({
  games: z.array(attendanceGameRequestSchema).min(1),
  plannedLeaveAt: z
    .string()
    .datetime()
    .optional()
    .describe(multilingual('Planned leave time for attendance registration.', '计划退勤时间。')),
  comment: z.string().optional().describe(multilingual('Attendance report note.', '上报说明。'))
});

export const attendanceQuerySchema = z.object({
  reported: z
    .string()
    .optional()
    .describe(
      multilingual(
        'Whether to fetch only registered (`false`) or reported (`true`) attendance records.',
        '是否仅获取登记 (false) / 上报 (true) 的在勤人数。'
      )
    )
});

export const attendanceResponseSchema = z.object({
  success: z.boolean(),
  total: z
    .int()
    .describe(
      multilingual(
        'Combined attendance count from registered and reported data.',
        '综合在勤人数，结合登记与上报人数综合计算得出。'
      )
    ),
  games: z.array(
    gameSchema.extend({
      total: z
        .int()
        .describe(multilingual('Combined attendance count for this game.', '机台综合在勤人数。'))
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
  slotIndex: z.string().min(1).describe(multilingual('Slot index.', '槽位。')),
  userId: z
    .string()
    .nullable()
    .describe(
      multilingual(
        'User ID in the slot, or null for an empty/private slot.',
        '用户 ID；空位或非公开位置可为 null。'
      )
    )
});

export const queuePositionSchema = z.object({
  machineName: z.string().describe(multilingual('Machine name.', '机台名。')),
  position: z.int().describe(multilingual('Queue position.', '位置。')),
  isPublic: z.boolean().describe(multilingual('Whether this position is public.', '是否为公开位置。')),
  status: queueStatusSchema.describe(multilingual('Queue status.', '状态。')),
  members: z
    .array(queueMemberSchema)
    .describe(multilingual('Members in this queue position.', '成员列表。'))
});

export const queuesPostBodySchema = z.object({
  queues: z
    .array(
      z.object({
        gameId: z.int().describe(multilingual('Game/version ID.', '游戏（版本）ID。')),
        queue: z.array(queuePositionSchema).describe(multilingual('Queue positions.', '队列。'))
      })
    )
    .min(1)
});

export const queuePostResponseSchema = successResponseSchema.extend({
  notificationsQueued: z
    .int()
    .optional()
    .describe(
      multilingual('Number of notifications queued by the update.', '本次更新加入通知队列的数量。')
    )
});

export const queueViewerUserSchema = z.object({
  id: z.string().describe(multilingual('User ID.', '用户 ID。')),
  name: z.string().describe(multilingual('Username.', '用户名。')),
  displayName: z
    .string()
    .nullable()
    .optional()
    .describe(multilingual('Display name when available.', '用户示名。')),
  image: z
    .string()
    .nullable()
    .optional()
    .describe(multilingual('Avatar URL when available.', '头像。'))
});

export const queueMemberWithUserSchema = queueMemberSchema.extend({
  user: queueViewerUserSchema
    .nullable()
    .describe(
      multilingual('Resolved user data for a visible queue member.', '公开队列成员对应的用户信息。')
    )
});

export const queuePositionWithUsersSchema = queuePositionSchema.extend({
  members: z
    .array(queueMemberWithUserSchema)
    .describe(
      multilingual(
        'Members in this queue position, enriched with public user data.',
        '该位置的成员列表，包含公开的用户信息。'
      )
    )
});

export const queueGameStateSchema = z.object({
  gameId: z.int().describe(multilingual('Game/version ID.', '游戏（版本）ID。')),
  queue: z
    .array(queuePositionWithUsersSchema)
    .describe(multilingual('Queue positions for the game.', '该游戏的队列位置。'))
});

export const queuesGetResponseSchema = successResponseSchema.extend({
  queues: z
    .array(queueGameStateSchema)
    .describe(multilingual('Current queue data for the shop.', '店铺当前机台队列数据。'))
});

export { shopIdParamSchema };

export type CreateShopBody = z.infer<typeof createShopBodySchema>;
export type UpdateShopBody = z.infer<typeof updateShopBodySchema>;
export type QueueGameDataBody = z.infer<typeof queuesPostBodySchema>['queues'][number];

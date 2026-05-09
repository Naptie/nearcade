import { z } from 'zod';
import {
  multilingual,
  locationSchema,
  openingHoursSchema,
  successResponseSchema,
  userPublicSchema
} from '../schemas/common';
import {
  activateMachineResponseSchema,
  registrationBodySchema,
  registrationCreateResponseSchema,
  registrationGetResponseSchema
} from '../schemas/machines';
import {
  attendanceGameRequestSchema,
  attendancePostBodySchema,
  createShopBodySchema,
  queuePostResponseSchema,
  queuesGetResponseSchema,
  queuesPostBodySchema,
  shopAddressSchema,
  updateShopBodySchema
} from '../schemas/shops';

const gameOpenApiSchema = z.object({
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
  quantity: z.int().min(0).default(1).describe(multilingual('Number of machines.', '机台数量。')),
  cost: z.string().default('').describe(multilingual('Price note.', '价格说明。'))
});

const shopOpenApiSchema = z.object({
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
  games: z
    .array(gameOpenApiSchema)
    .describe(multilingual('Machines/games available at the shop.', '机台。')),
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

const attendanceGameOpenApiSchema = gameOpenApiSchema.extend({
  total: z
    .int()
    .describe(multilingual('Combined attendance count for this game.', '机台综合在勤人数。'))
});

const attendanceResponseOutputSchema = z.object({
  success: z.boolean(),
  total: z
    .int()
    .describe(
      multilingual(
        'Combined attendance count from registered and reported data.',
        '综合在勤人数，结合登记与上报人数综合计算得出。'
      )
    ),
  games: z.array(attendanceGameOpenApiSchema),
  registered: z.array(
    z.object({
      userId: z.string().optional(),
      gameId: attendanceGameRequestSchema.shape.id,
      attendedAt: z.string(),
      plannedLeaveAt: z.string(),
      user: userPublicSchema.optional()
    })
  ),
  reported: z.array(
    z.object({
      gameId: attendanceGameRequestSchema.shape.id,
      currentAttendances: z.int(),
      comment: z.string().nullable(),
      reportedBy: z.string(),
      reportedAt: z.string(),
      reporter: userPublicSchema.optional()
    })
  )
});

const discoverShopOpenApiSchema = shopOpenApiSchema.extend({
  distance: z
    .number()
    .describe(multilingual('Distance from the origin in kilometers.', '店铺距离，单位 km。')),
  totalAttendance: z
    .int()
    .optional()
    .describe(multilingual('Combined shop attendance count.', '店铺综合在勤人数。')),
  currentReportedAttendance: z
    .object({
      reportedAt: z.string(),
      reportedBy: z.string(),
      reporter: userPublicSchema.optional(),
      comment: z.string().nullable()
    })
    .nullable()
    .optional()
    .describe(multilingual('Current attendance report.', '当前在勤人数报告。'))
});

const discoverResponseOutputSchema = z.object({
  shops: z.array(discoverShopOpenApiSchema).describe(multilingual('Nearby shops.', '店铺列表。')),
  location: z
    .object({
      name: z.string().nullable(),
      latitude: z.number(),
      longitude: z.number()
    })
    .describe(multilingual('Origin location.', '原点。')),
  radius: z.number().describe(multilingual('Search radius in kilometers.', '范围半径。'))
});

export const successOpenApiSchema = successResponseSchema.meta({ id: 'SuccessResponse' });
export const createShopRequestSchema = createShopBodySchema.meta({ id: 'CreateShopRequest' });
export const shopResponseOpenApiSchema = z
  .object({ shop: shopOpenApiSchema })
  .meta({ id: 'ShopResponse' });
export const shopsListResponseOpenApiSchema = z
  .object({
    shops: z.array(shopOpenApiSchema),
    totalCount: z.int(),
    currentPage: z.int(),
    hasNextPage: z.boolean(),
    hasPrevPage: z.boolean()
  })
  .meta({ id: 'ShopsListResponse' });
export const updateShopRequestSchema = updateShopBodySchema.meta({ id: 'UpdateShopRequest' });
export const attendanceRequestSchema = attendancePostBodySchema.meta({ id: 'AttendanceRequest' });
export const attendanceResponseOpenApiSchema = attendanceResponseOutputSchema.meta({
  id: 'AttendanceResponse'
});
export const discoverResponseOpenApiSchema = discoverResponseOutputSchema.meta({
  id: 'DiscoverResponse'
});
export const machineActivationResponseOpenApiSchema = activateMachineResponseSchema.meta({
  id: 'MachineActivationResponse'
});
export const attendanceRegistrationRequestSchema = registrationBodySchema.meta({
  id: 'AttendanceRegistrationRequest'
});
export const attendanceRegistrationCreateResponseOpenApiSchema =
  registrationCreateResponseSchema.meta({ id: 'AttendanceRegistrationCreateResponse' });
export const attendanceRegistrationGetResponseOpenApiSchema = registrationGetResponseSchema.meta({
  id: 'AttendanceRegistrationGetResponse'
});
export const queueReportRequestSchema = queuesPostBodySchema.meta({ id: 'QueueReportRequest' });
export const queueReportResponseOpenApiSchema = queuePostResponseSchema.meta({
  id: 'QueueReportResponse'
});
export const queueListResponseOpenApiSchema = queuesGetResponseSchema.meta({
  id: 'QueueListResponse'
});

import { z } from 'zod';
import {
  bilingual,
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
      bilingual('游戏（版本）ID；BEMANICN 数据源等同于机台 ID。', 'Game/version ID. For BEMANICN this equals the machine ID.')
    ),
  titleId: z.int().describe(bilingual('游戏系列 ID。', 'Game series ID.')),
  name: z.string().describe(bilingual('游戏名。', 'Game name.')),
  version: z.string().describe(bilingual('游戏版本。', 'Game version.')),
  comment: z.string().default('').describe(bilingual('游戏说明。', 'Game note.')),
  quantity: z.int().min(0).default(1).describe(bilingual('机台数量。', 'Number of machines.')),
  cost: z.string().default('').describe(bilingual('价格说明。', 'Price note.'))
});

const shopOpenApiSchema = z.object({
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
  games: z
    .array(gameOpenApiSchema)
    .describe(bilingual('机台。', 'Machines/games available at the shop.')),
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

const attendanceGameOpenApiSchema = gameOpenApiSchema.extend({
  total: z
    .int()
    .describe(bilingual('机台综合在勤人数。', 'Combined attendance count for this game.'))
});

const attendanceResponseOutputSchema = z.object({
  success: z.boolean(),
  total: z
    .int()
    .describe(
      bilingual('综合在勤人数，结合登记与上报人数综合计算得出。', 'Combined attendance count from registered and reported data.')
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
    .describe(bilingual('店铺距离，单位 km。', 'Distance from the origin in kilometers.')),
  totalAttendance: z
    .int()
    .optional()
    .describe(bilingual('店铺综合在勤人数。', 'Combined shop attendance count.')),
  currentReportedAttendance: z
    .object({
      reportedAt: z.string(),
      reportedBy: z.string(),
      reporter: userPublicSchema.optional(),
      comment: z.string().nullable()
    })
    .nullable()
    .optional()
    .describe(bilingual('当前在勤人数报告。', 'Current attendance report.'))
});

const discoverResponseOutputSchema = z.object({
  shops: z.array(discoverShopOpenApiSchema).describe(bilingual('店铺列表。', 'Nearby shops.')),
  location: z
    .object({
      name: z.string().nullable(),
      latitude: z.number(),
      longitude: z.number()
    })
    .describe(bilingual('原点。', 'Origin location.')),
  radius: z.number().describe(bilingual('范围半径。', 'Search radius in kilometers.'))
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

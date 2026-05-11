import { z } from 'zod';
import { PAGINATION } from '../constants';
import {
  bilingual,
  dateTimeSchema,
  locationSchema,
  openingHoursSchema,
  optionalBooleanString,
  paginationQuerySchema,
  shopIdParamSchema,
  successResponseSchema,
  userIdSchema,
  userPublicSchema
} from './common';
import { commentVoteSchema } from './comments';
import { imageAssetIdSchema, imageAssetSchema, imageStorageProviderSchema } from './images';

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
const attendedAtSchema = dateTimeSchema(
  bilingual('登记在勤时间。', 'Attendance registration time.')
);
const plannedLeaveAtSchema = dateTimeSchema(bilingual('计划退勤时间。', 'Planned leave time.'));
const optionalPlannedLeaveAtSchema = dateTimeSchema(
  bilingual('计划退勤时间。', 'Planned leave time for attendance registration.')
).optional();
export const partialAttendanceUserSchema = userPublicSchema
  .pick({
    id: true,
    name: true,
    image: true,
    displayName: true
  })
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
export const reportedAtSchema = dateTimeSchema(bilingual('上报时间。', 'Attendance report time.'));

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
  createdAt: dateTimeSchema(bilingual('创建时间。', 'Creation time.')).optional(),
  updatedAt: dateTimeSchema(bilingual('更新时间。', 'Update time.'))
});

export const shopsListQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional().default('').describe(bilingual('查询字符串。', 'Search query string.')),
  includeTimeInfo: includeTimeInfoSchema
});

export const shopDetailQuerySchema = z.object({
  includeTimeInfo: includeTimeInfoSchema
});

export const createShopRequestSchema = z.object({
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

export const updateShopRequestSchema = z
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

export const attendanceRequestSchema = z.object({
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

export const queueReportRequestSchema = z.object({
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

export const shopChangelogQuerySchema = z.object({
  page: positiveIntegerQueryParamSchema(
    bilingual('页数。默认为 1。', 'Page number. Defaults to 1.'),
    1
  ),
  limit: positiveIntegerQueryParamSchema(
    bilingual(
      '每页返回的更新记录数量。默认为站点分页大小，最大为 100。',
      'Number of changelog entries per page. Defaults to the site page size, up to 100.'
    ),
    PAGINATION.PAGE_SIZE,
    100
  )
});

export const shopHistoryQuerySchema = z.object({
  page: positiveIntegerQueryParamSchema(
    bilingual('页数。默认为 1。', 'Page number. Defaults to 1.'),
    1
  ),
  limit: positiveIntegerQueryParamSchema(
    bilingual(
      '每页返回的在勤历史条目数量。默认为 10，最大为 100。',
      'Number of attendance history entries per page. Defaults to 10, up to 100.'
    ),
    10,
    100
  )
});

export const shopChangelogActionSchema = z
  .enum([
    'created',
    'modified',
    'deleted',
    'game_added',
    'game_modified',
    'game_deleted',
    'photo_uploaded',
    'photo_deleted',
    'rollback',
    'delete_request_submitted',
    'delete_request_approved',
    'delete_request_rejected',
    'photo_delete_request_submitted',
    'photo_delete_request_approved',
    'photo_delete_request_rejected'
  ])
  .describe(bilingual('店铺变更动作类型。', 'Shop changelog action type.'));

export const shopChangelogEntryIdParamSchema = shopIdParamSchema.extend({
  entryId: z.string().describe(bilingual('更新记录 ID。', 'Changelog entry ID.'))
});

const shopChangelogFieldInfoSchema = z.object({
  field: z.string().describe(bilingual('变更字段。', 'Field changed by this entry.')),
  gameId: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(bilingual('关联游戏 ID。', 'Associated game ID.')),
  gameName: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('关联游戏名称。', 'Associated game name.')),
  gameVersion: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('关联游戏版本。', 'Associated game version.')),
  photoId: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('关联照片 ID。', 'Associated photo ID.')),
  photoUrl: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('关联照片 URL。', 'Associated photo URL.')),
  deleteRequestId: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('关联删除申请 ID。', 'Associated delete request ID.'))
});

const shopChangelogMetadataSchema = z
  .object({})
  .catchall(z.unknown())
  .describe(bilingual('附加元数据。', 'Additional metadata.'))
  .meta({ override: { type: 'object', additionalProperties: true } });

const shopChangelogUserSchema = z
  .object({
    id: userIdSchema,
    name: z.string().nullable().describe(bilingual('用户名。', 'Username.')),
    displayName: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('显示名称。', 'Display name.')),
    image: z.string().nullable().describe(bilingual('头像。', 'Avatar URL.'))
  })
  .describe(bilingual('触发该变更的用户。', 'User who caused the change.'));

export const shopChangelogEntrySchema = z
  .object({
    _id: z.string().optional().describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: z.string().describe(bilingual('更新记录 ID。', 'Changelog entry ID.')),
    shopId: shopIdSchema,
    shopName: shopNameSchema,
    action: shopChangelogActionSchema,
    fieldInfo: shopChangelogFieldInfoSchema.describe(
      bilingual('变更字段信息。', 'Changed field information.')
    ),
    oldValue: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('变更前的存储值。', 'Stored value before the change.')),
    newValue: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('变更后的存储值。', 'Stored value after the change.')),
    metadata: shopChangelogMetadataSchema.optional(),
    userId: userIdSchema
      .nullable()
      .describe(bilingual('变更操作者用户 ID。', 'User ID who performed the change.')),
    createdAt: dateTimeSchema(bilingual('变更时间。', 'Change time.')),
    user: shopChangelogUserSchema.optional()
  })
  .describe(bilingual('店铺更新记录。', 'Shop changelog entry.'));

export const shopChangelogListResponseSchema = z.object({
  entries: z
    .array(shopChangelogEntrySchema)
    .describe(bilingual('更新记录列表。', 'Changelog entries.')),
  total: z.int().min(0).describe(bilingual('更新记录总数。', 'Total changelog entry count.')),
  page: z.int().min(1).describe(bilingual('当前页。', 'Current page.')),
  limit: z.int().min(1).describe(bilingual('每页条目数。', 'Items per page.')),
  hasMore: z.boolean().describe(bilingual('是否还有更多条目。', 'Whether more entries exist.')),
  totalPages: z.int().min(0).describe(bilingual('总页数。', 'Total page count.'))
});

const attendanceHistoryGameSchema = z.object({
  gameId: gameIdSchema,
  name: gameNameSchema,
  version: gameVersionSchema,
  currentAttendances: currentAttendancesSchema
});

export const attendanceHistoryEntrySchema = z.object({
  _id: z.string().describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
  shopId: shopIdSchema,
  games: z
    .array(attendanceHistoryGameSchema)
    .describe(bilingual('本次上报的游戏在勤数据。', 'Per-game attendance data in this report.')),
  comment: attendanceReportCommentSchema,
  reportedBy: reportedBySchema,
  reportedAt: reportedAtSchema,
  reporter: partialAttendanceUserSchema.describe(
    bilingual('上报者信息。', 'Reporter user summary.')
  )
});

export const shopHistoryResponseSchema = successResponseSchema.extend({
  data: z
    .array(attendanceHistoryEntrySchema)
    .describe(bilingual('在勤历史条目。', 'Attendance history entries.')),
  pagination: z.object({
    page: z.int().min(1).describe(bilingual('当前页。', 'Current page.')),
    limit: z.int().min(1).describe(bilingual('每页条目数。', 'Items per page.')),
    totalCount: z.int().min(0).describe(bilingual('历史条目总数。', 'Total history entry count.')),
    totalPages: z.int().min(0).describe(bilingual('总页数。', 'Total page count.')),
    hasMore: z.boolean().describe(bilingual('是否还有更多条目。', 'Whether more entries exist.'))
  })
});

export const shopDeleteRequestIdSchema = z
  .string()
  .describe(bilingual('删除申请 ID。', 'Delete request ID.'));

export const shopDeleteRequestIdParamSchema = z.object({
  id: shopDeleteRequestIdSchema
});

export const shopDeleteRequestStatusSchema = z
  .enum(['pending', 'approved', 'rejected'])
  .describe(bilingual('删除申请状态。', 'Delete request status.'));

export const shopDeleteRequestStatusFilterSchema = z
  .enum(['all', 'pending', 'approved', 'rejected'])
  .default('pending')
  .describe(
    bilingual(
      '删除申请状态筛选；`all` 表示不过滤状态。',
      'Delete request status filter. Use `all` to disable status filtering.'
    )
  );

export const shopDeleteRequestVoteTypeSchema = z
  .enum(['favor', 'against'])
  .describe(
    bilingual(
      '删除申请投票类型；`favor` 为支持删除，`against` 为反对删除。',
      'Delete request vote type. `favor` supports deletion and `against` opposes it.'
    )
  );

const shopDeleteRequestReviewActionSchema = z
  .enum(['approve', 'reject'])
  .describe(
    bilingual(
      '审核动作；`approve` 为批准，`reject` 为拒绝。',
      'Review action. `approve` accepts the request and `reject` denies it.'
    )
  );

export const shopPhotoSchema = imageAssetSchema
  .extend({
    shopId: shopIdSchema
  })
  .describe(bilingual('店铺照片。', 'Shop photo.'));

export const shopDeleteRequestVoteSchema = z
  .object({
    _id: z.string().optional().describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: z.string().describe(bilingual('投票 ID。', 'Vote ID.')),
    shopDeleteRequestId: shopDeleteRequestIdSchema,
    userId: userIdSchema,
    voteType: shopDeleteRequestVoteTypeSchema,
    createdAt: dateTimeSchema(bilingual('投票时间。', 'Vote time.')),
    updatedAt: dateTimeSchema(bilingual('投票更新时间。', 'Vote update time.')).optional()
  })
  .describe(bilingual('删除申请投票。', 'Delete request vote.'));

export const shopDeleteRequestVoteSummarySchema = z.object({
  favorVotes: z.int().min(0).describe(bilingual('支持删除的票数。', 'Votes in favor of deletion.')),
  againstVotes: z.int().min(0).describe(bilingual('反对删除的票数。', 'Votes against deletion.')),
  userVote: shopDeleteRequestVoteTypeSchema
    .nullable()
    .optional()
    .describe(bilingual('当前用户的投票。', 'Current user vote.'))
});

export const shopDeleteRequestSchema = z
  .object({
    _id: z.string().optional().describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: shopDeleteRequestIdSchema,
    shopId: shopIdSchema,
    shopName: shopNameSchema,
    reason: z.string().describe(bilingual('删除申请原因。', 'Delete request reason.')),
    images: z
      .array(imageAssetIdSchema)
      .optional()
      .describe(bilingual('关联图片资源 ID 列表。', 'Attached image asset IDs.')),
    resolvedImages: z
      .array(imageAssetSchema)
      .optional()
      .describe(bilingual('已解析的关联图片资源。', 'Resolved attached image assets.')),
    requestedBy: userIdSchema
      .nullable()
      .describe(bilingual('提交申请的用户 ID。', 'Requester user ID.')),
    requestedByName: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('提交申请的用户名。', 'Requester username.')),
    status: shopDeleteRequestStatusSchema,
    createdAt: dateTimeSchema(bilingual('提交时间。', 'Submission time.')),
    reviewedAt: dateTimeSchema(bilingual('审核时间。', 'Review time.')).nullable().optional(),
    reviewedBy: userIdSchema
      .nullable()
      .optional()
      .describe(bilingual('审核者用户 ID。', 'Reviewer user ID.')),
    reviewNote: z.string().nullable().optional().describe(bilingual('审核备注。', 'Review note.')),
    photoId: z
      .string()
      .nullable()
      .optional()
      .describe(
        bilingual(
          '照片删除申请中的目标照片 ID；为空时表示整店删除申请。',
          'Target photo ID for photo deletion requests. Null means this is a whole-shop request.'
        )
      ),
    photoUrl: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('目标照片 URL。', 'Target photo URL.'))
  })
  .describe(bilingual('店铺删除申请。', 'Shop delete request.'));

export const shopDeleteRequestsListQuerySchema = z.object({
  status: shopDeleteRequestStatusFilterSchema
});

export const shopDeleteRequestsListResponseSchema = z.object({
  requests: z
    .array(shopDeleteRequestSchema)
    .describe(bilingual('删除申请列表。', 'Delete request list.')),
  currentStatus: shopDeleteRequestStatusFilterSchema.describe(
    bilingual('当前状态筛选。', 'Current status filter.')
  )
});

export const shopDeleteRequestDetailResponseSchema = z.object({
  deleteRequest: shopDeleteRequestSchema.describe(
    bilingual('删除申请详情。', 'Delete request details.')
  ),
  voteSummary: shopDeleteRequestVoteSummarySchema.describe(
    bilingual('删除申请投票汇总。', 'Delete request vote summary.')
  )
});

export const shopDeleteRequestCreateRequestSchema = z.object({
  reason: z.string().trim().min(1).describe(bilingual('删除申请原因。', 'Delete request reason.')),
  photoId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(bilingual('目标照片 ID。', 'Target photo ID.')),
  images: z
    .array(imageAssetIdSchema)
    .optional()
    .default([])
    .describe(bilingual('附带的图片资源 ID 列表。', 'Attached image asset IDs.'))
});

export const shopDeleteRequestCreateResponseSchema = successResponseSchema.extend({
  id: shopDeleteRequestIdSchema
});

export const shopDeleteRequestReviewRequestSchema = z.object({
  action: shopDeleteRequestReviewActionSchema,
  reviewNote: z.string().trim().optional().describe(bilingual('审核备注。', 'Review note.'))
});

export const shopDeleteRequestReviewResponseSchema = successResponseSchema.extend({
  status: shopDeleteRequestStatusSchema.describe(
    bilingual('审核后的删除申请状态。', 'Delete request status after review.')
  )
});

export const shopDeleteRequestCommentSchema = z
  .object({
    _id: z.string().optional().describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: z.string().describe(bilingual('评论 ID。', 'Comment ID.')),
    shopDeleteRequestId: shopDeleteRequestIdSchema,
    content: z
      .string()
      .describe(bilingual('评论内容（Markdown）。', 'Comment content in Markdown.')),
    images: z
      .array(imageAssetIdSchema)
      .optional()
      .describe(bilingual('评论图片资源 ID 列表。', 'Comment image asset IDs.')),
    resolvedImages: z
      .array(imageAssetSchema)
      .optional()
      .describe(bilingual('已解析的评论图片资源。', 'Resolved comment image assets.')),
    createdBy: userIdSchema.describe(bilingual('评论作者用户 ID。', 'Comment author user ID.')),
    createdAt: dateTimeSchema(bilingual('评论时间。', 'Comment creation time.')),
    updatedAt: dateTimeSchema(bilingual('评论更新时间。', 'Comment update time.')).optional(),
    parentCommentId: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('父评论 ID。', 'Parent comment ID.')),
    upvotes: z.int().min(0).describe(bilingual('点赞数。', 'Upvote count.')),
    downvotes: z.int().min(0).describe(bilingual('点踩数。', 'Downvote count.')),
    author: userPublicSchema.optional().describe(bilingual('评论作者。', 'Comment author.')),
    vote: commentVoteSchema
      .optional()
      .describe(bilingual('当前用户对评论的投票。', 'Current user vote on the comment.')),
    authorDeleteRequestVote: shopDeleteRequestVoteSchema
      .nullable()
      .optional()
      .describe(
        bilingual('评论作者对该删除申请的投票。', 'Delete request vote cast by the comment author.')
      )
  })
  .describe(bilingual('删除申请评论。', 'Delete request comment.'));

export const shopDeleteRequestCommentsResponseSchema = z
  .array(shopDeleteRequestCommentSchema)
  .describe(bilingual('删除申请评论列表。', 'Delete request comments.'));

export const shopDeleteRequestCommentCreateRequestSchema = z
  .object({
    content: z
      .string()
      .trim()
      .optional()
      .default('')
      .describe(bilingual('评论内容（Markdown）。', 'Comment content in Markdown.')),
    parentCommentId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(bilingual('父评论 ID。', 'Parent comment ID.')),
    images: z
      .array(imageAssetIdSchema)
      .optional()
      .default([])
      .describe(bilingual('评论图片资源 ID 列表。', 'Comment image asset IDs.'))
  })
  .refine((value) => value.content.length > 0 || value.images.length > 0, {
    message: 'Comment content or images are required'
  });

export const shopDeleteRequestCommentCreateResponseSchema = successResponseSchema.extend({
  commentId: z.string().describe(bilingual('新评论 ID。', 'New comment ID.')),
  id: z.string().describe(bilingual('操作 ID。', 'Operation ID.'))
});

export const shopDeleteRequestVoteRequestSchema = z.object({
  voteType: shopDeleteRequestVoteTypeSchema
});

export const shopDeleteRequestVoteResponseSchema = successResponseSchema.extend({
  favorVotes: shopDeleteRequestVoteSummarySchema.shape.favorVotes,
  againstVotes: shopDeleteRequestVoteSummarySchema.shape.againstVotes,
  userVote: shopDeleteRequestVoteSummarySchema.shape.userVote
});

export const shopCommentEntrySchema = z
  .object({
    _id: z.string().optional().describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: z.string().describe(bilingual('评论 ID。', 'Comment ID.')),
    shopId: shopIdSchema,
    content: z
      .string()
      .describe(bilingual('评论内容（Markdown）。', 'Comment content in Markdown.')),
    images: z
      .array(imageAssetIdSchema)
      .optional()
      .describe(bilingual('评论图片资源 ID 列表。', 'Comment image asset IDs.')),
    resolvedImages: z
      .array(imageAssetSchema)
      .optional()
      .describe(bilingual('已解析的评论图片资源。', 'Resolved comment image assets.')),
    createdBy: userIdSchema.describe(bilingual('评论作者用户 ID。', 'Comment author user ID.')),
    createdAt: dateTimeSchema(bilingual('评论时间。', 'Comment creation time.')),
    updatedAt: dateTimeSchema(bilingual('评论更新时间。', 'Comment update time.')).optional(),
    parentCommentId: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('父评论 ID。', 'Parent comment ID.')),
    upvotes: z.int().min(0).describe(bilingual('点赞数。', 'Upvote count.')),
    downvotes: z.int().min(0).describe(bilingual('点踩数。', 'Downvote count.')),
    author: userPublicSchema.optional().describe(bilingual('评论作者。', 'Comment author.')),
    vote: commentVoteSchema
      .optional()
      .describe(bilingual('当前用户对评论的投票。', 'Current user vote on the comment.'))
  })
  .describe(bilingual('店铺评论。', 'Shop comment.'));

export const shopCommentsResponseSchema = z
  .array(shopCommentEntrySchema)
  .describe(bilingual('店铺评论列表。', 'Shop comments.'));

export const shopCommentCreateRequestSchema = shopDeleteRequestCommentCreateRequestSchema;

export const shopCommentCreateResponseSchema = successResponseSchema.extend({
  commentId: z.string().describe(bilingual('新评论 ID。', 'New comment ID.'))
});

export const shopPhotoIdParamSchema = shopIdParamSchema.extend({
  photoId: z.string().describe(bilingual('店铺照片 ID。', 'Shop photo ID.'))
});

export const shopPhotosResponseSchema = z.object({
  photos: z.array(shopPhotoSchema).describe(bilingual('店铺照片列表。', 'Shop photos.'))
});

export const shopPhotoUploadRequestSchema = z.object({
  file: z
    .string()
    .describe(bilingual('要上传的图片文件。', 'Image file to upload.'))
    .meta({ override: { type: 'string', format: 'binary' } })
});

export const shopPhotoUploadProgressEventSchema = z.object({
  phase: z.literal('uploading').describe(bilingual('上传阶段。', 'Upload phase.')),
  progress: z
    .number()
    .min(0)
    .max(1)
    .describe(
      bilingual(
        '服务端上传到对象存储的进度，范围为 0 到 1。',
        'Server-to-object-storage progress from 0 to 1.'
      )
    )
});

export const shopPhotoUploadDoneEventSchema = z.object({
  phase: z.literal('done').describe(bilingual('上传阶段。', 'Upload phase.')),
  photoId: z.string().describe(bilingual('新照片 ID。', 'New photo ID.')),
  url: z.string().describe(bilingual('上传后的照片 URL。', 'Uploaded photo URL.')),
  storageProvider: imageStorageProviderSchema,
  storageKey: z.string().describe(bilingual('存储键。', 'Storage key.')),
  storageObjectId: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('远端存储对象 ID。', 'Remote storage object ID.'))
});

export const shopPhotoUploadErrorEventSchema = z.object({
  phase: z.literal('error').describe(bilingual('上传阶段。', 'Upload phase.')),
  message: z.string().describe(bilingual('上传失败信息。', 'Upload failure message.'))
});

export const shopPhotoUploadEventSchema = z
  .union([
    shopPhotoUploadProgressEventSchema,
    shopPhotoUploadDoneEventSchema,
    shopPhotoUploadErrorEventSchema
  ])
  .describe(
    bilingual(
      '照片上传事件。响应为 NDJSON，每行一个事件对象。',
      'Photo upload event. The response is NDJSON with one event object per line.'
    )
  );

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

export { shopIdParamSchema };

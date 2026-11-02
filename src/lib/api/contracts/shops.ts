import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual, fileUploadSchema, successResponseSchema } from '$lib/schemas/common';
import {
  adminUpdateShopRequestSchema,
  attendanceQuerySchema,
  attendanceRegisterRequestSchema,
  attendanceReportRequestSchema,
  attendanceRequestSchema,
  attendanceResponseSchema,
  createShopRequestSchema,
  queueReportRequestSchema,
  queueReportResponseSchema,
  queuesListResponseSchema,
  shopChangelogEntryIdParamSchema,
  shopChangelogListResponseSchema,
  shopChangelogQuerySchema,
  shopCommentCreateRequestSchema,
  shopCommentCreateResponseSchema,
  shopCommentsResponseSchema,
  shopDeleteRequestCommentCreateRequestSchema,
  shopDeleteRequestCommentCreateResponseSchema,
  shopDeleteRequestCommentsResponseSchema,
  shopDeleteRequestCreateRequestSchema,
  shopDeleteRequestCreateResponseSchema,
  shopDeleteRequestDetailResponseSchema,
  shopDeleteRequestIdParamSchema,
  shopDeleteRequestReviewRequestSchema,
  shopDeleteRequestReviewResponseSchema,
  shopDeleteRequestVoteRequestSchema,
  shopDeleteRequestVoteResponseSchema,
  shopDeleteRequestsListQuerySchema,
  shopDeleteRequestsListResponseSchema,
  shopDetailQuerySchema,
  shopHistoryQuerySchema,
  shopHistoryResponseSchema,
  shopIdParamSchema,
  shopPhotoIdParamSchema,
  shopPhotosResponseSchema,
  shopResponseSchema,
  shopsListQuerySchema,
  shopsListResponseSchema,
  updateShopRequestSchema
} from '$lib/schemas/shops';
import {
  attendanceRegistrationCreateResponseSchema,
  attendanceRegistrationGetResponseSchema,
  attendanceRegistrationPostRequestSchema,
  registrationQuerySchema
} from '$lib/schemas/machines';

/** The shop id taken from the path — oRPC merges path parameters into `input`. */
const shopIdInput = shopIdParamSchema.shape.id;

/** The delete-request id taken from the path. */
const deleteRequestIdInput = shopDeleteRequestIdParamSchema.shape.id;

/**
 * The list query, plus the legacy `titleIds` filter the shared page-query
 * parser still reads.
 *
 * `q` / `sort` / `page` / `f` / `regionId` / `titleIds` all travel through the
 * shared shop page-query contract, so the REST endpoint matches the `/shops`
 * page and the globe exactly.
 */
const shopsListInputSchema = shopsListQuerySchema.extend({
  titleIds: z
    .string()
    .optional()
    .describe(
      bilingual(
        '旧版游戏系列 ID 筛选（逗号分隔）。',
        'Legacy game title IDs to filter by (comma separated).'
      )
    )
});

const shopDetailInputSchema = shopDetailQuerySchema.extend({ id: shopIdInput });
const attendanceInputSchema = attendanceQuerySchema.extend({ id: shopIdInput });
const changelogInputSchema = shopChangelogQuerySchema.extend({ id: shopIdInput });
const historyInputSchema = shopHistoryQuerySchema.extend({ id: shopIdInput });

/**
 * The update body plus the shop id from the path.
 *
 * `updateShopRequestSchema` refuses an empty body; the id from the path must
 * not satisfy that check, so the body fields are counted on their own.
 */
const updateShopInputSchema = z
  .object({ id: shopIdInput, ...updateShopRequestSchema.shape })
  .refine((value) => Object.keys(value).some((key) => key !== 'id'), 'No fields to update');

/** The admin update body plus the shop id — same "no fields" rule as above. */
const adminUpdateShopInputSchema = z
  .object({ id: shopIdInput, ...adminUpdateShopRequestSchema.shape })
  .refine((value) => Object.keys(value).some((key) => key !== 'id'), 'No fields to update');

const attendancePostInputSchema = attendanceRequestSchema.extend({ id: shopIdInput });
const attendanceRegisterInputSchema = attendanceRegisterRequestSchema.extend({ id: shopIdInput });
const attendanceReportCountsInputSchema = attendanceReportRequestSchema.extend({ id: shopIdInput });
const registrationPostInputSchema = attendanceRegistrationPostRequestSchema.extend({
  id: shopIdInput
});
const registrationGetInputSchema = registrationQuerySchema.extend({ id: shopIdInput });

/**
 * `DELETE /shops/{id}/attendance/registration` takes its token from the query
 * string, and oRPC's compact input structure only reads the query string for
 * `GET`. The detailed structure keeps the query parameters in the contract
 * instead of hiding them from it.
 */
const registrationDeleteInputSchema = z.object({
  params: z.object({ id: shopIdInput }),
  query: registrationQuerySchema
});

const commentCreateInputSchema = shopCommentCreateRequestSchema.extend({ id: shopIdInput });
const deleteRequestCreateInputSchema = shopDeleteRequestCreateRequestSchema.extend({
  id: shopIdInput
});
const deleteRequestReviewInputSchema = shopDeleteRequestReviewRequestSchema.extend({
  id: deleteRequestIdInput
});
const deleteRequestCommentCreateInputSchema = shopDeleteRequestCommentCreateRequestSchema.extend({
  id: deleteRequestIdInput
});
const deleteRequestVoteInputSchema = shopDeleteRequestVoteRequestSchema.extend({
  id: deleteRequestIdInput
});
const queueReportInputSchema = queueReportRequestSchema.extend({ id: shopIdInput });

/** A multipart upload: one image file. */
const photoUploadInputSchema = z.object({
  id: shopIdInput,
  file: fileUploadSchema.describe(bilingual('要上传的图片文件。', 'Image file to upload.'))
});

export const shopsContract = {
  /** `GET /api/shops` — paginated shop list. */
  list: definePublic({
    method: 'GET',
    path: '/shops',
    operationId: 'getShops',
    tags: ['shops'],
    scope: 'open',
    summary: bilingual('获取店铺列表。', 'List shops.', true),
    description: bilingual(
      '获取分页店铺列表。支持查询字符串，并可选择是否包含计算得出的时区与营业状态。',
      'Get a paginated list of shops. Supports text search and optional computed time information.'
    )
  })
    .input(shopsListInputSchema)
    .output(shopsListResponseSchema),

  /** `POST /api/shops` — create a shop. */
  create: definePublic({
    method: 'POST',
    path: '/shops',
    operationId: 'postShops',
    tags: ['shops'],
    scope: 'write:shops',
    guard: 'session',
    successStatus: 201,
    summary: bilingual('创建店铺。', 'Create shop.', true),
    description: bilingual('创建新店铺。', 'Create a new shop.')
  })
    .input(createShopRequestSchema)
    .output(shopResponseSchema),

  /** `GET /api/shops/{id}` — shop details. */
  detail: definePublic({
    method: 'GET',
    path: '/shops/{id}',
    operationId: 'getShopsById',
    tags: ['shops'],
    scope: 'open',
    summary: bilingual('获取店铺详情。', 'Get shop details.', true),
    description: bilingual('按 ID 获取店铺详情。', 'Get details for a shop by ID.')
  })
    .input(shopDetailInputSchema)
    .output(shopResponseSchema),

  /** `PUT /api/shops/{id}` — update a shop. */
  update: definePublic({
    method: 'PUT',
    path: '/shops/{id}',
    operationId: 'putShopsById',
    tags: ['shops'],
    scope: 'write:shops',
    guard: 'session',
    summary: bilingual('更新店铺。', 'Update shop.', true),
    description: bilingual('按 ID 更新店铺字段。', 'Update shop fields by ID.')
  })
    .input(updateShopInputSchema)
    .output(shopResponseSchema),

  /** `PATCH /api/shops/{id}` — admin-only shop update. */
  adminUpdate: definePublic({
    method: 'PATCH',
    path: '/shops/{id}',
    operationId: 'patchShopsById',
    tags: ['shops'],
    scope: 'write:shops',
    guard: 'site_admin',
    summary: bilingual('管理员更新店铺。', 'Admin update shop.', true),
    description: bilingual(
      '管理员按 ID 更新店铺的管理字段（如锁定状态）。',
      'Admin-only endpoint to update administrative shop fields (e.g. locked status) by ID.'
    )
  })
    .input(adminUpdateShopInputSchema)
    .output(shopResponseSchema),

  /** `GET /api/shops/{id}/attendance` — attendance of a shop. */
  attendance: definePublic({
    method: 'GET',
    path: '/shops/{id}/attendance',
    operationId: 'getShopsByIdAttendance',
    tags: ['shops'],
    scope: 'open',
    summary: bilingual('获取在勤人数。', 'Get attendance.', true),
    description: bilingual(
      '获取店铺综合、登记和上报的在勤人数。',
      'Get combined, registered, and reported attendance for a shop.'
    )
  })
    .input(attendanceInputSchema)
    .output(attendanceResponseSchema),

  /**
   * `POST /api/shops/{id}/attendance` — **deprecated**.
   *
   * This endpoint used to carry two capabilities: registering your own
   * attendance and reporting the live occupancy counts. They now live on
   * endpoints of their own — `POST /api/shops/{id}/attendance/new` and
   * `POST /api/shops/{id}/attendance/reports` — so that each one can carry
   * the scope that describes it.
   *
   * The endpoint keeps working: it routes to the right one by the shape of the
   * payload, and each branch still demands the scope of the capability it
   * performs. It carries no scope of its own for that reason, so a client that
   * wants either capability should move to the endpoint that names it.
   */
  reportAttendance: definePublic({
    method: 'POST',
    path: '/shops/{id}/attendance',
    operationId: 'postShopsByIdAttendance',
    tags: ['shops'],
    scope: 'open',
    // A signed-in user, or a bearer agent API key. The key may be a composite
    // `agent/user` pair that reports attendance on behalf of someone, which no
    // session resolver can read — the handler verifies it, the guard only has
    // to admit the request.
    guard: 'session_or_agent_key',
    credentials: ['agent_key'],
    deprecated: true,
    summary: bilingual(
      '登记在勤或上报在勤人数（已弃用）。',
      'Register or report attendance (deprecated).',
      true
    ),
    description: bilingual(
      '已弃用：请改用 `POST /api/shops/{id}/attendance/new` 登记在勤，或 `POST /api/shops/{id}/attendance/reports` 上报在勤人数。本接口按请求体形状转发到对应接口，每个分支仍要求该能力对应的 scope。登记在勤仅限已登录用户；机台密钥只能上报在勤人数。',
      'Deprecated: use `POST /api/shops/{id}/attendance/new` to register your attendance, or `POST /api/shops/{id}/attendance/reports` to report attendance counts. This endpoint forwards to the right one by the shape of the payload, and each branch still demands the scope of the capability it performs. Registering attendance needs a signed-in user; a machine key can only report attendance counts.'
    )
  })
    .input(attendancePostInputSchema)
    .output(successResponseSchema),

  /** `POST /api/shops/{id}/attendance/new` — register the caller's own attendance. */
  registerAttendance: definePublic({
    method: 'POST',
    path: '/shops/{id}/attendance/new',
    operationId: 'postShopsByIdAttendanceNew',
    tags: ['shops'],
    scope: 'write:attendance',
    guard: 'session',
    summary: bilingual('登记在勤。', 'Register attendance.', true),
    description: bilingual(
      '登记当前用户在勤，出现在所玩机台的玩家列表中。出勤次数达到您自己的阈值后，机厅会自动进入您的常去机厅列表。仅限已登录用户；机台密钥只能上报在勤人数。',
      "Register the caller's own attendance, so they appear in the player list of the machine they are playing. Once the number of visits crosses your own threshold, the arcade joins your frequently-visited list automatically. A signed-in user only; a machine key can only report attendance counts."
    )
  })
    .input(attendanceRegisterInputSchema)
    .output(successResponseSchema),

  /** `POST /api/shops/{id}/attendance/reports` — report the live occupancy. */
  reportAttendanceCounts: definePublic({
    method: 'POST',
    path: '/shops/{id}/attendance/reports',
    operationId: 'postShopsByIdAttendanceReports',
    tags: ['shops'],
    scope: 'write:reports',
    // A signed-in user (the crowd-sourced report for an unclaimed arcade), or
    // a bearer agent API key bound to the shop.
    guard: 'session_or_agent_key',
    credentials: ['agent_key'],
    summary: bilingual('上报在勤人数。', 'Report attendance counts.', true),
    description: bilingual(
      '上报某机厅当前各游戏的在勤人数。未被认领的机厅由任何登录用户上报；已被认领的机厅只能由绑定该机厅的代理密钥上报。',
      'Report how many people are currently playing each game at an arcade. An unclaimed arcade is reported by any signed-in user; a claimed arcade only by the agent key bound to it.'
    )
  })
    .input(attendanceReportCountsInputSchema)
    .output(successResponseSchema),

  /** `DELETE /api/shops/{id}/attendance` — leave the shop. */
  leaveAttendance: definePublic({
    method: 'DELETE',
    path: '/shops/{id}/attendance',
    operationId: 'deleteShopsByIdAttendance',
    tags: ['shops'],
    scope: 'write:attendance',
    guard: 'session',
    summary: bilingual('退勤。', 'Leave attendance.', true),
    description: bilingual(
      '从某店铺的当前在勤中移除当前用户。',
      'Remove the current user from active attendance at a shop.'
    )
  })
    .input(z.object({ id: shopIdInput }))
    .output(successResponseSchema),

  /** `POST /api/shops/{id}/attendance/registration` — kiosk registration token. */
  createAttendanceRegistration: definePublic({
    method: 'POST',
    path: '/shops/{id}/attendance/registration',
    operationId: 'postShopsByIdAttendanceRegistration',
    tags: ['shops'],
    scope: null,
    guard: 'machine',
    credentials: ['machine'],
    summary: bilingual('申请玩家登记令牌。', 'Create player registration token.', true),
    description: bilingual(
      '为机台槽位创建短期玩家登记令牌。',
      'Create a short-lived player registration token for a machine slot.'
    )
  })
    .input(registrationPostInputSchema)
    .output(attendanceRegistrationCreateResponseSchema),

  /** `GET /api/shops/{id}/attendance/registration` — kiosk registration state. */
  getAttendanceRegistration: definePublic({
    method: 'GET',
    path: '/shops/{id}/attendance/registration',
    operationId: 'getShopsByIdAttendanceRegistration',
    tags: ['shops'],
    scope: null,
    guard: 'machine',
    credentials: ['machine'],
    summary: bilingual('获取玩家登记信息。', 'Get player registration.', true),
    description: bilingual(
      '通过令牌获取玩家登记信息。调用方需携带机台密钥，而不是用户会话。',
      'Get player registration data by token. The caller presents a machine key, not a user session.'
    )
  })
    .input(registrationGetInputSchema)
    .output(attendanceRegistrationGetResponseSchema),

  /** `DELETE /api/shops/{id}/attendance/registration` — destroy the token. */
  deleteAttendanceRegistration: definePublic({
    method: 'DELETE',
    path: '/shops/{id}/attendance/registration',
    operationId: 'deleteShopsByIdAttendanceRegistration',
    tags: ['shops'],
    scope: null,
    guard: 'machine',
    credentials: ['machine'],
    inputStructure: 'detailed',
    summary: bilingual('销毁玩家登记令牌。', 'Delete player registration token.', true),
    description: bilingual('销毁玩家登记令牌。', 'Delete a player registration token.')
  })
    .input(registrationDeleteInputSchema)
    .output(successResponseSchema),

  /** `GET /api/shops/{id}/changelog` — paginated changelog. */
  changelog: definePublic({
    method: 'GET',
    path: '/shops/{id}/changelog',
    operationId: 'getShopsByIdChangelog',
    tags: ['shops'],
    scope: 'open',
    summary: bilingual('获取店铺更新记录。', 'Get shop changelog.', true),
    description: bilingual(
      '分页获取店铺更新记录，包括游戏、照片和删除申请相关的变更。',
      'Get paginated shop changelog entries, including changes related to games, photos, and delete requests.'
    )
  })
    .input(changelogInputSchema)
    .output(shopChangelogListResponseSchema),

  /** `DELETE /api/shops/{id}/changelog/{entryId}` — delete one changelog entry. */
  deleteChangelogEntry: definePublic({
    method: 'DELETE',
    path: '/shops/{id}/changelog/{entryId}',
    operationId: 'deleteShopsByIdChangelogByEntryId',
    tags: ['shops'],
    scope: 'write:shops',
    guard: 'site_admin',
    summary: bilingual('删除店铺更新记录。', 'Delete a shop changelog entry.', true),
    description: bilingual(
      '删除指定的店铺更新记录，仅站点管理员可用。',
      'Delete a specific shop changelog entry. This endpoint is available to site administrators only.'
    )
  })
    .input(shopChangelogEntryIdParamSchema)
    .output(successResponseSchema),

  /** `GET /api/shops/{id}/comments` — shop comments. */
  comments: definePublic({
    method: 'GET',
    path: '/shops/{id}/comments',
    operationId: 'getShopsByIdComments',
    tags: ['shops'],
    scope: 'open',
    summary: bilingual('获取店铺评论。', 'Get shop comments.', true),
    description: bilingual(
      '获取店铺评论列表，包含作者信息、当前用户对评论的投票，以及已解析的评论图片。',
      "Get comments for a shop, including comment authors, the current user's vote on each comment, and resolved comment images."
    )
  })
    .input(z.object({ id: shopIdInput }))
    .output(shopCommentsResponseSchema),

  /** `POST /api/shops/{id}/comments` — post a shop comment. */
  createComment: definePublic({
    method: 'POST',
    path: '/shops/{id}/comments',
    operationId: 'postShopsByIdComments',
    tags: ['shops'],
    scope: 'write:comments',
    guard: 'session',
    successStatus: 201,
    summary: bilingual('发表评论到店铺。', 'Post a shop comment.', true),
    description: bilingual(
      '向店铺发表评论或回复，可附带图片。',
      'Add a comment or reply to a shop, optionally with images.'
    )
  })
    .input(commentCreateInputSchema)
    .output(shopCommentCreateResponseSchema),

  /** `POST /api/shops/{id}/delete-request` — open a delete request. */
  createDeleteRequest: definePublic({
    method: 'POST',
    path: '/shops/{id}/delete-request',
    operationId: 'postShopsByIdDeleteRequest',
    tags: ['shops'],
    scope: 'write:moderation',
    guard: 'session',
    successStatus: 201,
    summary: bilingual('提交店铺删除申请。', 'Submit a shop delete request.', true),
    description: bilingual(
      '为整店或店铺照片提交删除申请。若指定 `photoId`，则表示照片删除申请；否则表示整店删除申请。',
      'Submit a deletion request for an entire shop or for a specific shop photo. When `photoId` is present, this becomes a photo deletion request.'
    )
  })
    .input(deleteRequestCreateInputSchema)
    .output(shopDeleteRequestCreateResponseSchema),

  /** `GET /api/shops/{id}/history` — attendance report history. */
  history: definePublic({
    method: 'GET',
    path: '/shops/{id}/history',
    operationId: 'getShopsByIdHistory',
    tags: ['shops'],
    scope: 'open',
    summary: bilingual('获取在勤历史。', 'Get attendance history.', true),
    description: bilingual(
      '分页获取店铺的历史在勤上报记录。',
      'Get paginated historical attendance reports for a shop.'
    )
  })
    .input(historyInputSchema)
    .output(shopHistoryResponseSchema),

  /** `GET /api/shops/{id}/photos` — shop photos. */
  photos: definePublic({
    method: 'GET',
    path: '/shops/{id}/photos',
    operationId: 'getShopsByIdPhotos',
    tags: ['shops'],
    scope: 'open',
    summary: bilingual('获取店铺照片。', 'Get shop photos.', true),
    description: bilingual(
      '获取店铺照片列表，并包含上传者信息。',
      'Get the list of shop photos together with uploader information.'
    )
  })
    .input(z.object({ id: shopIdInput }))
    .output(shopPhotosResponseSchema),

  /**
   * `POST /api/shops/{id}/photos` — upload a photo.
   *
   * The response is an NDJSON event stream, not a JSON body, so it has no
   * output schema: the stream is returned as-is and its headers are set
   * through the response headers.
   */
  uploadPhoto: definePublic({
    method: 'POST',
    path: '/shops/{id}/photos',
    operationId: 'postShopsByIdPhotos',
    tags: ['shops'],
    scope: 'write:shops',
    guard: 'session',
    summary: bilingual('上传店铺照片。', 'Upload a shop photo.', true),
    description: bilingual(
      '上传一张店铺照片，并以 NDJSON 事件流返回上传进度与结果：每行一个事件对象，阶段为 uploading、done 或 error。',
      'Upload a shop photo and receive progress and completion events as an NDJSON stream: one event object per line, with the phase uploading, done or error.'
    )
  }).input(photoUploadInputSchema),

  /** `DELETE /api/shops/{id}/photos/{photoId}` — delete a photo. */
  deletePhoto: definePublic({
    method: 'DELETE',
    path: '/shops/{id}/photos/{photoId}',
    operationId: 'deleteShopsByIdPhotosByPhotoId',
    tags: ['shops'],
    scope: 'write:shops',
    guard: 'session',
    summary: bilingual('删除店铺照片。', 'Delete a shop photo.', true),
    description: bilingual(
      '站点管理员和照片上传者可以直接删除照片；其他用户应使用照片删除申请流程。',
      'Site administrators and the photo uploader can delete a shop photo directly. Other users should use the photo delete-request flow instead.'
    )
  })
    .input(shopPhotoIdParamSchema)
    .output(successResponseSchema),

  /** `GET /api/shops/{id}/queues` — machine queues. */
  queues: definePublic({
    method: 'GET',
    path: '/shops/{id}/queues',
    operationId: 'getShopsByIdQueues',
    tags: ['shops'],
    scope: 'open',
    summary: bilingual('获取机台队列。', 'Get machine queues.', true),
    description: bilingual('获取店铺当前机台队列数据。', 'Get current queue data for a shop.')
  })
    .input(z.object({ id: shopIdInput }))
    .output(queuesListResponseSchema),

  /** `POST /api/shops/{id}/queues` — report machine queues. */
  reportQueues: definePublic({
    method: 'POST',
    path: '/shops/{id}/queues',
    operationId: 'postShopsByIdQueues',
    tags: ['shops'],
    scope: null,
    guard: 'machine',
    credentials: ['machine'],
    summary: bilingual('上报机台队列。', 'Report machine queues.', true),
    description: bilingual(
      '上报店铺中一个或多个游戏的机台队列状态。',
      'Report machine queue states for one or more games in a shop.'
    )
  })
    .input(queueReportInputSchema)
    .output(queueReportResponseSchema),

  /** `GET /api/shops/delete-requests` — delete request list. */
  listDeleteRequests: definePublic({
    method: 'GET',
    path: '/shops/delete-requests',
    operationId: 'getShopsDeleteRequests',
    tags: ['shops'],
    scope: 'open',
    summary: bilingual('获取删除申请列表。', 'List delete requests.', true),
    description: bilingual(
      '获取店铺删除申请列表，并可按状态筛选。',
      'List shop delete requests and optionally filter them by status.'
    )
  })
    .input(shopDeleteRequestsListQuerySchema)
    .output(shopDeleteRequestsListResponseSchema),

  /** `GET /api/shops/delete-requests/{id}` — delete request details. */
  getDeleteRequest: definePublic({
    method: 'GET',
    path: '/shops/delete-requests/{id}',
    operationId: 'getShopsDeleteRequestsById',
    tags: ['shops'],
    scope: 'open',
    summary: bilingual('获取删除申请详情。', 'Get delete request details.', true),
    description: bilingual(
      '获取单个店铺删除申请详情及其投票汇总。',
      'Get details for a single shop delete request together with its vote summary.'
    )
  })
    .input(shopDeleteRequestIdParamSchema)
    .output(shopDeleteRequestDetailResponseSchema),

  /** `PATCH /api/shops/delete-requests/{id}` — approve or reject a request. */
  reviewDeleteRequest: definePublic({
    method: 'PATCH',
    path: '/shops/delete-requests/{id}',
    operationId: 'patchShopsDeleteRequestsById',
    tags: ['shops'],
    scope: null,
    guard: 'site_admin',
    summary: bilingual('审核删除申请。', 'Review a delete request.', true),
    description: bilingual(
      '由站点管理员批准或拒绝待处理的店铺删除申请。',
      'Approve or reject a pending shop delete request as a site administrator.'
    )
  })
    .input(deleteRequestReviewInputSchema)
    .output(shopDeleteRequestReviewResponseSchema),

  /** `DELETE /api/shops/delete-requests/{id}` — retract or delete a request. */
  deleteDeleteRequest: definePublic({
    method: 'DELETE',
    path: '/shops/delete-requests/{id}',
    operationId: 'deleteShopsDeleteRequestsById',
    tags: ['shops'],
    scope: 'write:moderation',
    guard: 'session',
    summary: bilingual('删除或撤回删除申请。', 'Delete or retract a delete request.', true),
    description: bilingual(
      '提交者可撤回自己的待处理申请，站点管理员可删除任意删除申请。',
      'The requester can retract their own pending request, while site administrators can delete any delete request.'
    )
  })
    .input(shopDeleteRequestIdParamSchema)
    .output(successResponseSchema),

  /** `GET /api/shops/delete-requests/{id}/comments` — delete request comments. */
  getDeleteRequestComments: definePublic({
    method: 'GET',
    path: '/shops/delete-requests/{id}/comments',
    operationId: 'getShopsDeleteRequestsByIdComments',
    tags: ['shops'],
    scope: 'open',
    summary: bilingual('获取删除申请评论。', 'Get delete request comments.', true),
    description: bilingual(
      '获取删除申请下的评论列表，包含作者信息、当前用户的评论投票，以及评论作者对该删除申请的投票。',
      "Get comments for a delete request, including comment authors, the current user's comment vote, and the delete-request vote cast by each comment author."
    )
  })
    .input(shopDeleteRequestIdParamSchema)
    .output(shopDeleteRequestCommentsResponseSchema),

  /** `POST /api/shops/delete-requests/{id}/comments` — comment on a request. */
  createDeleteRequestComment: definePublic({
    method: 'POST',
    path: '/shops/delete-requests/{id}/comments',
    operationId: 'postShopsDeleteRequestsByIdComments',
    tags: ['shops'],
    scope: 'write:comments',
    guard: 'session',
    successStatus: 201,
    summary: bilingual('发表评论到删除申请。', 'Post a comment on a delete request.', true),
    description: bilingual(
      '向待处理的删除申请添加评论或回复，可附带图片。',
      'Add a comment or reply to a pending delete request, optionally with images.'
    )
  })
    .input(deleteRequestCommentCreateInputSchema)
    .output(shopDeleteRequestCommentCreateResponseSchema),

  /** `POST /api/shops/delete-requests/{id}/vote` — vote on a request. */
  voteDeleteRequest: definePublic({
    method: 'POST',
    path: '/shops/delete-requests/{id}/vote',
    operationId: 'postShopsDeleteRequestsByIdVote',
    tags: ['shops'],
    scope: 'write:moderation',
    guard: 'session',
    summary: bilingual('对删除申请投票。', 'Vote on a delete request.', true),
    description: bilingual(
      '对待处理的删除申请投支持或反对票。重复提交相同投票会撤销该投票。',
      'Cast a supporting or opposing vote on a pending delete request. Sending the same vote twice removes the existing vote.'
    )
  })
    .input(deleteRequestVoteInputSchema)
    .output(shopDeleteRequestVoteResponseSchema)
};

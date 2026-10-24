import { z } from 'zod';
import { definePrivate } from '../contract';
import { bilingual, dateTimeSchema, locationSchema } from '$lib/schemas/common';
import { shopChangelogRollbackBodySchema } from '$lib/schemas/shops';
import { ugcEntryActionRequestSchema, ugcEntryActionResponseSchema } from '$lib/schemas/ugc';

/**
 * The admin API.
 *
 * Every procedure here is **private**: it is served at its documented URL, but
 * it is never published in the OpenAPI document and third-party OAuth clients
 * are refused. The authorization itself lives in the implementation — a
 * `site_admin` session, or, for the data-update trigger, the shared service
 * secret.
 */

/** The region id taken from the path — oRPC merges path parameters into `input`. */
const regionIdInput = z.string().describe(bilingual('地区 ID。', 'Region ID.'));

/** The user id taken from the path. */
const userIdInput = z.string().describe(bilingual('用户 ID。', 'User ID.'));

/** The shop id taken from the path. */
const shopIdInput = z.coerce.number().int().describe(bilingual('店铺 ID。', 'Shop ID.'));

/**
 * A query parameter the legacy handlers trimmed before using it.
 *
 * `url.searchParams.get('q')?.trim() ?? ''` — reproduced here so the search
 * terms reach the implementation exactly as they did before.
 */
const trimmedQueryParam = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? '');

/**
 * A numeric query parameter the legacy handlers clamped.
 *
 * `Math.max(1, parseInt(raw || '1'))` and
 * `Math.min(100, Math.max(1, parseInt(raw || '10')))` — reproduced exactly so
 * the pagination of the admin user list does not change.
 */
const clampedIntQueryParam = (fallback: string, clamp: (value: number) => number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      const raw = value === undefined || value === null || value === '' ? fallback : String(value);
      return clamp(Number.parseInt(raw));
    });

// ── data updates ────────────────────────────────────────────────────────────

/** One data-update task, as the admin monitor shows it. */
export const dataUpdateTaskSchema = z.object({
  id: z.string().describe(bilingual('任务 ID。', 'Task ID.')),
  status: z
    .enum(['idle', 'running', 'succeeded', 'failed'])
    .describe(bilingual('任务状态。', 'Task status.')),
  startedAt: dateTimeSchema(bilingual('开始时间。', 'Start time.')).nullable(),
  finishedAt: dateTimeSchema(bilingual('结束时间。', 'Finish time.')).nullable(),
  lastSuccessfulAt: dateTimeSchema(
    bilingual('最近一次成功时间。', 'Last successful run.')
  ).nullable(),
  updatedAt: dateTimeSchema(bilingual('更新时间。', 'Update time.')),
  durationMs: z.number().nullable(),
  lastError: z.string().nullable(),
  progress: z
    .object({
      processed: z.number(),
      total: z.number().nullable()
    })
    .nullable(),
  summary: z
    .record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()]))
    .nullable(),
  triggerSource: z.enum(['site_admin', 'ssc', 'startup']).nullable(),
  triggerUserId: z.string().nullable(),
  triggerUserName: z.string().nullable()
});

/**
 * The trigger URL the admin page posts to.
 *
 * It is the absolute URL of this very endpoint, so an unattended caller can
 * replay the trigger without knowing the deployment's origin.
 */
const triggerUrlSchema = z.string().describe(bilingual('触发接口地址。', 'Trigger endpoint URL.'));

// ── regions ─────────────────────────────────────────────────────────────────

/** A node of the admin region tree. */
const adminRegionNodeSchema = z.object({
  id: z.string().describe(bilingual('地区 ID。', 'Region ID.')),
  parentId: z.string().nullable().describe(bilingual('父级地区 ID。', 'Parent region ID.')),
  level: z
    .enum(['country', 'province', 'city', 'county', 'street'])
    .describe(bilingual('地区层级。', 'Region level.')),
  name: z.record(z.string(), z.string()).describe(bilingual('各语言名称。', 'Localized names.')),
  population: z.number().nullable(),
  area: z.number().nullable(),
  location: locationSchema.nullable(),
  hasChildren: z
    .boolean()
    .describe(bilingual('是否还有下级地区。', 'Whether it has child regions.')),
  /** Only search hits carry their ancestor chain (root → parent). */
  ancestors: z
    .array(z.object({ id: z.string(), name: z.record(z.string(), z.string()) }))
    .optional()
});

// ── users ───────────────────────────────────────────────────────────────────

/**
 * A user document as the admin endpoints return it.
 *
 * The legacy handlers handed the stored document back verbatim, so the schema
 * stays loose: it documents the fields the admin UI reads and keeps every
 * other key of the document untouched.
 */
export const adminUserDocumentSchema = z.looseObject({
  id: z.string().describe(bilingual('用户 ID。', 'User ID.')),
  name: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  userType: z.string().optional(),
  bio: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  joinedAt: z.string().optional(),
  lastActiveAt: z.string().optional(),
  phone: z.string().optional(),
  phoneDialCode: z.string().optional(),
  /** Only the detailed search mode reports the membership counts. */
  universitiesCount: z.number().optional(),
  clubsCount: z.number().optional()
});

/**
 * A joined organization, as it appears on a membership.
 *
 * The `$lookup` that joins the organization onto the membership projects only
 * its id and name, so those are the only two fields the client ever sees.
 */
const adminJoinedOrganizationSchema = z.looseObject({ id: z.string(), name: z.string() });

/** A university membership together with the joined university. */
export const adminUniversityMembershipSchema = z.looseObject({
  id: z.string().describe(bilingual('成员关系 ID。', 'Membership ID.')),
  universityId: z.string().describe(bilingual('大学 ID。', 'University ID.')),
  userId: z.string().describe(bilingual('用户 ID。', 'User ID.')),
  memberType: z.string().describe(bilingual('成员角色。', 'Membership role.')),
  joinedAt: z.string().optional(),
  /** The joined university — absent when the membership has no match. */
  university: adminJoinedOrganizationSchema.optional()
});

/** A club membership together with the joined club. */
export const adminClubMembershipSchema = z.looseObject({
  id: z.string().describe(bilingual('成员关系 ID。', 'Membership ID.')),
  clubId: z.string().describe(bilingual('社团 ID。', 'Club ID.')),
  userId: z.string().describe(bilingual('用户 ID。', 'User ID.')),
  memberType: z.string().describe(bilingual('成员角色。', 'Membership role.')),
  joinedAt: z.string().optional(),
  /** The joined club — absent when the membership has no match. */
  club: adminJoinedOrganizationSchema.optional()
});

// ── UGC job monitor ─────────────────────────────────────────────────────────

const ugcAuditQueueItemSchema = z.object({
  hash: z.string(),
  kind: z.string(),
  refId: z.string(),
  text: z.string()
});

const ugcTranslationQueueItemSchema = z.object({
  hash: z.string(),
  targets: z.array(z.string()),
  text: z.string()
});

// ── Users ──────────────────────────────────────────────────────────────────

/**
 * The answer of the user-detail procedure.
 *
 * Named and exported so the implementation can hand its documents to the same
 * schema the contract validates against, instead of casting them into the
 * output type by hand.
 */
export const adminUserDetailResponseSchema = z.object({
  user: adminUserDocumentSchema,
  universityMemberships: z.array(adminUniversityMembershipSchema),
  clubMemberships: z.array(adminClubMembershipSchema)
});

/**
 * The answer of the user-search procedure.
 *
 * `currentPage` and `hasMore` are present only in detailed mode.
 */
export const adminUsersSearchResponseSchema = z.object({
  users: z.array(adminUserDocumentSchema),
  currentPage: z.number().optional(),
  hasMore: z.boolean().optional()
});

export const adminContract = {
  /** `GET /api/admin/data-updates` — the state of every data-update task. */
  dataUpdates: definePrivate({
    method: 'GET',
    path: '/admin/data-updates',
    // A `site_admin` session, or the shared service secret so that unattended
    // automation can poll task state without holding a user session.
    guard: 'site_admin_or_secret',
    credentials: ['secret'],
    operationId: 'adminGetDataUpdates',
    tags: ['admin'],
    summary: bilingual('获取数据更新任务状态。', 'Get the data-update task states.', true),
    description: bilingual(
      '返回所有数据更新任务的状态；带上 task 参数时只返回该任务的状态。',
      'Returns the state of every data-update task; with the `task` parameter only that task is returned.'
    )
  })
    .input(
      z.object({
        task: z.string().optional().describe(bilingual('任务 ID。', 'Task ID.'))
      })
    )
    .output(
      z.union([
        z.object({ task: dataUpdateTaskSchema, triggerUrl: triggerUrlSchema }),
        z.object({ tasks: z.array(dataUpdateTaskSchema), triggerUrl: triggerUrlSchema })
      ])
    ),

  /** `POST /api/admin/data-updates` — trigger one data-update task. */
  triggerDataUpdate: definePrivate({
    method: 'POST',
    path: '/admin/data-updates',
    // A `site_admin` session, or the shared service secret so that unattended
    // automation can start a task — the same two callers the legacy handler
    // accepted.
    guard: 'site_admin_or_secret',
    credentials: ['secret'],
    operationId: 'adminTriggerDataUpdate',
    tags: ['admin'],
    summary: bilingual('触发数据更新任务。', 'Trigger a data-update task.', true),
    description: bilingual(
      '启动指定的数据更新任务，并返回任务的当前状态。',
      'Starts the given data-update task and returns its current state.'
    )
  })
    .input(
      z.object({
        task: z.string().optional().describe(bilingual('任务 ID。', 'Task ID.'))
      })
    )
    .output(
      z.object({
        started: z.boolean(),
        alreadyRunning: z.boolean(),
        task: dataUpdateTaskSchema,
        triggerUrl: triggerUrlSchema
      })
    ),

  /** `GET /api/admin/organizations/search` — search universities and clubs. */
  searchOrganizations: definePrivate({
    method: 'GET',
    path: '/admin/organizations/search',
    guard: 'site_admin',
    operationId: 'adminSearchOrganizations',
    tags: ['admin'],
    summary: bilingual('搜索学校或社团。', 'Search universities or clubs.', true),
    description: bilingual(
      '按 ID、slug 或名称搜索学校（type=university）或社团（type=club）。',
      'Searches universities (`type=university`) or clubs (`type=club`) by ID, slug or name.'
    )
  })
    .input(
      z.object({
        type: trimmedQueryParam.describe(bilingual('组织类型。', 'Organization type.')),
        q: trimmedQueryParam.describe(bilingual('搜索关键词。', 'Search query.'))
      })
    )
    .output(
      z.object({
        organizations: z.array(
          z.looseObject({
            id: z.string(),
            name: z.string(),
            slug: z.string().optional()
          })
        )
      })
    ),

  /** `GET /api/admin/regions` — the lazily loaded admin region tree. */
  listRegions: definePrivate({
    method: 'GET',
    path: '/admin/regions',
    guard: 'site_admin',
    operationId: 'adminListRegions',
    tags: ['admin'],
    summary: bilingual('获取地区树。', 'Get the region tree.', true),
    description: bilingual(
      '支持按关键词搜索地区（q）、按父级展开下一级（parentId），不带参数时返回顶级国家。',
      'Searches regions by keyword (`q`), loads the children of a region (`parentId`), or returns the top-level countries when no parameter is given.'
    )
  })
    .input(
      z.object({
        q: z.string().optional().describe(bilingual('搜索关键词。', 'Search query.')),
        parentId: z
          .string()
          .optional()
          .transform((value) => value || null)
          .describe(bilingual('父级地区 ID。', 'Parent region ID.'))
      })
    )
    .output(z.object({ regions: z.array(adminRegionNodeSchema) })),

  /** `PUT /api/admin/regions/{id}` — update a region. */
  updateRegion: definePrivate({
    method: 'PUT',
    path: '/admin/regions/{id}',
    guard: 'site_admin',
    operationId: 'adminUpdateRegion',
    tags: ['admin'],
    summary: bilingual('更新地区。', 'Update a region.', true),
    description: bilingual(
      '按 ID 更新地区的名称、面积、人口或坐标；至少要提供一个字段。',
      'Updates the name, area, population or location of a region by ID; at least one field is required.'
    )
  })
    .input(
      z
        .object({
          id: regionIdInput,
          name: z.record(z.string(), z.string()).optional(),
          area: z.number().min(0).nullable().optional(),
          population: z.number().min(0).nullable().optional(),
          location: locationSchema.nullable().optional()
        })
        // The description promises at least one field; the request schema has
        // to promise it too, or the published document accepts a body the
        // endpoint refuses.
        .refine((value) => Object.keys(value).some((key) => key !== 'id'), 'No fields to update')
    )
    .output(z.object({ success: z.boolean() })),

  /** `DELETE /api/admin/regions/{id}` — delete a region. */
  deleteRegion: definePrivate({
    method: 'DELETE',
    path: '/admin/regions/{id}',
    guard: 'site_admin',
    operationId: 'adminDeleteRegion',
    tags: ['admin'],
    summary: bilingual('删除地区。', 'Delete a region.', true),
    description: bilingual(
      '按 ID 删除地区；地区仍有下级或仍被店铺引用时拒绝删除。',
      'Deletes a region by ID; the deletion is refused while the region still has children or is still referenced by a shop.'
    )
  })
    .input(z.object({ id: regionIdInput }))
    .output(z.object({ success: z.boolean() })),

  /** `PUT /api/admin/shops/{id}/rollback` — roll a shop back to a changelog entry. */
  rollbackShop: definePrivate({
    method: 'PUT',
    path: '/admin/shops/{id}/rollback',
    guard: 'site_admin',
    operationId: 'adminRollbackShop',
    tags: ['admin'],
    summary: bilingual('回滚店铺更新。', 'Roll a shop back.', true),
    description: bilingual(
      '将店铺回滚到指定的更新记录；不指定记录时回滚到店铺创建时的状态。',
      'Rolls a shop back to the given changelog entry; without one the shop is rolled back to its creation state.'
    )
  })
    .input(shopChangelogRollbackBodySchema.extend({ id: shopIdInput }))
    .output(
      z.object({
        success: z.boolean(),
        shopId: z.number(),
        shopName: z.string(),
        targetEntryId: z.string().nullable(),
        appliedEntryIds: z.array(z.string()),
        retention: z.enum(['keep', 'purge']),
        removedPhotoIds: z.array(z.string()),
        removedPhotoEntryIds: z.array(z.string()),
        failedPhotoIds: z.array(z.string()),
        notifiedUserIds: z.array(z.string()),
        snapshotStored: z.boolean()
      })
    ),

  /** `GET /api/admin/shops/search` — search shops by name or id. */
  searchShops: definePrivate({
    method: 'GET',
    path: '/admin/shops/search',
    guard: 'site_admin',
    operationId: 'adminSearchShops',
    tags: ['admin'],
    summary: bilingual('搜索店铺。', 'Search shops.', true),
    description: bilingual('按 ID 或名称搜索店铺。', 'Searches shops by ID or name.')
  })
    .input(z.object({ q: trimmedQueryParam.describe(bilingual('搜索关键词。', 'Search query.')) }))
    .output(
      z.object({
        shops: z.array(z.looseObject({ id: z.number(), name: z.string() }))
      })
    ),

  /** `POST /api/admin/ugc-entries` — manual review actions on registry content. */
  ugcEntryAction: definePrivate({
    method: 'POST',
    path: '/admin/ugc-entries',
    guard: 'site_admin',
    operationId: 'adminUgcEntryAction',
    tags: ['admin'],
    summary: bilingual('处理 UGC 条目。', 'Act on UGC entries.', true),
    description: bilingual(
      '对内容哈希或具体条目执行人工审核动作（送审、通过、标记复核、移除、恢复等），并返回受影响的条目数。',
      'Runs a manual review action (dispatch, pass, flag, remove, restore, …) on content hashes or specific entries and returns the number of affected entries.'
    )
  })
    .input(ugcEntryActionRequestSchema)
    .output(ugcEntryActionResponseSchema),

  /** `GET /api/admin/ugc/jobs` — the active UGC background queues. */
  ugcJobs: definePrivate({
    method: 'GET',
    path: '/admin/ugc/jobs',
    guard: 'site_admin',
    operationId: 'adminGetUgcJobs',
    tags: ['admin'],
    summary: bilingual('获取 UGC 队列监控。', 'Get the UGC queue monitor.', true),
    description: bilingual(
      '返回当前排队等待 AI 审核与 AI 翻译的任务数量，并预览最老的若干条。',
      'Returns how many jobs are queued for the AI audit and the AI translation, with a preview of the oldest entries.'
    )
  })
    .input(z.object({}))
    .output(
      z.object({
        audit: z.object({
          queued: z.number(),
          items: z.array(ugcAuditQueueItemSchema)
        }),
        translation: z.object({
          queued: z.number(),
          items: z.array(ugcTranslationQueueItemSchema)
        })
      })
    ),

  /** `GET /api/admin/users/{id}` — one user with its memberships. */
  userDetail: definePrivate({
    method: 'GET',
    path: '/admin/users/{id}',
    guard: 'site_admin',
    operationId: 'adminGetUser',
    tags: ['admin'],
    summary: bilingual('获取用户详情。', 'Get a user detail.', true),
    description: bilingual(
      '按 ID 获取用户资料，以及其学校与社团成员关系。',
      'Returns the profile of a user by ID together with its university and club memberships.'
    )
  })
    .input(z.object({ id: userIdInput }))
    .output(adminUserDetailResponseSchema),

  /** `GET /api/admin/users/search` — the admin user list. */
  searchUsers: definePrivate({
    method: 'GET',
    path: '/admin/users/search',
    guard: 'site_admin',
    operationId: 'adminSearchUsers',
    tags: ['admin'],
    summary: bilingual('搜索用户。', 'Search users.', true),
    description: bilingual(
      '按关键词、用户类型搜索用户；detailed=true 时返回分页结果与成员数量统计。',
      'Searches users by keyword and user type; with `detailed=true` the paginated result and the membership counts are returned.'
    )
  })
    .input(
      z.object({
        q: trimmedQueryParam.describe(bilingual('搜索关键词。', 'Search query.')),
        userType: trimmedQueryParam.describe(bilingual('用户类型。', 'User type.')),
        page: clampedIntQueryParam('1', (value) => Math.max(1, value)).describe(
          bilingual('页数。', 'Page number.')
        ),
        limit: clampedIntQueryParam('10', (value) => Math.min(100, Math.max(1, value))).describe(
          bilingual('每页条目数。', 'Items per page.')
        ),
        detailed: z
          .string()
          .optional()
          .transform((value) => value === 'true')
          .describe(bilingual('是否返回详细结果。', 'Whether to return the detailed result.'))
      })
    )
    .output(adminUsersSearchResponseSchema)
};

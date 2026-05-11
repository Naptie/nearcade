import { z } from 'zod';

import { postReadabilitySchema, postWritabilitySchema } from './posts';
import { shopSchema } from './shops';
import { bilingual, dateTimeSchema, locationSchema, objectIdSchema } from './common';

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

const userListItemSchema = z.object({
  id: z.string().optional().describe(bilingual('用户 ID。', 'User ID.')),
  name: z.string().nullable().optional().describe(bilingual('用户名。', 'Username.')),
  displayName: z.string().nullable().optional().describe(bilingual('显示名称。', 'Display name.')),
  image: z.string().nullable().optional().describe(bilingual('头像。', 'Avatar URL.'))
});

export const universityRouteIdSchema = z
  .string()
  .min(1)
  .describe(bilingual('大学 ID 或 slug。', 'University ID or slug.'));

export const universityIdParamSchema = z.object({
  id: universityRouteIdSchema
});

export const clubRouteIdSchema = z
  .string()
  .min(1)
  .describe(bilingual('社团 ID 或 slug。', 'Club ID or slug.'));

export const clubIdParamSchema = z.object({
  id: clubRouteIdSchema
});

export const organizationCanJoinSchema = z
  .union([z.literal(0), z.literal(1), z.literal(2)])
  .describe(
    bilingual(
      '加入状态：0 表示不可加入，1 表示已提交申请或已在等待验证，2 表示可发起加入。',
      'Join status: 0 means unavailable, 1 means already requested or pending verification, and 2 means the user can join.'
    )
  )
  .meta({ override: { type: 'integer', enum: [0, 1, 2] } });

export const clubPermissionSchema = z.object({
  canEdit: z.boolean().describe(bilingual('是否可编辑。', 'Whether editing is allowed.')),
  canManage: z.boolean().describe(bilingual('是否可管理。', 'Whether management is allowed.')),
  canJoin: organizationCanJoinSchema,
  role: z.string().optional().describe(bilingual('当前成员角色。', 'Current membership role.'))
});

export const universityPermissionSchema = clubPermissionSchema.extend({
  verificationEmail: z
    .string()
    .optional()
    .describe(bilingual('待验证邮箱。', 'Pending verification email.')),
  verifiedAt: dateTimeSchema(bilingual('认证时间。', 'Verification time.')).optional()
});

export const campusSchema = z.object({
  id: z.string().describe(bilingual('校区 ID。', 'Campus ID.')),
  name: z.string().nullable().describe(bilingual('校区名称。', 'Campus name.')),
  province: z.string().describe(bilingual('省份。', 'Province.')),
  city: z.string().describe(bilingual('城市。', 'City.')),
  district: z.string().describe(bilingual('区县。', 'District.')),
  address: z.string().describe(bilingual('详细地址。', 'Detailed address.')),
  location: locationSchema.describe(bilingual('校区坐标。', 'Campus coordinates.')),
  createdAt: dateTimeSchema(bilingual('创建时间。', 'Creation time.')).optional(),
  updatedAt: dateTimeSchema(bilingual('更新时间。', 'Update time.')).optional(),
  createdBy: z.string().optional().describe(bilingual('创建者用户 ID。', 'Creator user ID.')),
  updatedBy: z.string().optional().describe(bilingual('更新者用户 ID。', 'Updater user ID.'))
});

export const universitySchema = z
  .object({
    _id: z
      .union([z.string(), objectIdSchema])
      .optional()
      .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: z.string().describe(bilingual('大学 ID。', 'University ID.')),
    name: z.string().describe(bilingual('大学名称。', 'University name.')),
    slug: z.string().optional().describe(bilingual('大学 slug。', 'University slug.')),
    type: z.string().describe(bilingual('大学类型。', 'University type.')),
    majorCategory: z.string().nullable().describe(bilingual('学科类别。', 'Major category.')),
    natureOfRunning: z.string().nullable().describe(bilingual('办学性质。', 'Nature of running.')),
    affiliation: z.string().describe(bilingual('隶属关系。', 'Affiliation.')),
    is985: z
      .boolean()
      .nullable()
      .describe(bilingual('是否为 985。', 'Whether it is a 985 university.')),
    is211: z
      .boolean()
      .nullable()
      .describe(bilingual('是否为 211。', 'Whether it is a 211 university.')),
    isDoubleFirstClass: z
      .boolean()
      .nullable()
      .describe(bilingual('是否为双一流。', 'Whether it is double first class.')),
    campuses: z.array(campusSchema).describe(bilingual('校区列表。', 'Campus list.')),
    backgroundColor: z.string().optional().describe(bilingual('背景色。', 'Background color.')),
    avatarUrl: z.string().optional().describe(bilingual('头像 URL。', 'Avatar URL.')),
    avatarImageId: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('头像图片资源 ID。', 'Avatar image asset ID.')),
    description: z.string().optional().describe(bilingual('大学简介。', 'University description.')),
    website: z.string().optional().describe(bilingual('大学官网。', 'University website.')),
    postReadability: postReadabilitySchema.optional(),
    postWritability: postWritabilitySchema.optional(),
    studentsCount: z.int().min(0).optional().describe(bilingual('成员数。', 'Member count.')),
    frequentingArcades: z
      .array(z.int())
      .optional()
      .describe(bilingual('常去店铺 ID 列表。', 'Frequently visited arcade IDs.')),
    clubsCount: z.int().min(0).optional().describe(bilingual('社团数。', 'Club count.')),
    createdAt: dateTimeSchema(bilingual('创建时间。', 'Creation time.')).optional(),
    updatedAt: dateTimeSchema(bilingual('更新时间。', 'Update time.')).optional()
  })
  .describe(bilingual('大学。', 'University.'));

export const universitySummarySchema = universitySchema.pick({
  id: true,
  slug: true,
  name: true,
  avatarUrl: true,
  description: true,
  website: true,
  backgroundColor: true,
  postReadability: true,
  postWritability: true
});

export const universitiesSearchQuerySchema = z.object({
  q: z.string().optional().default('').describe(bilingual('搜索关键词。', 'Search query.'))
});

export const universitiesSearchResponseSchema = z.object({
  universities: z.array(universitySchema).describe(bilingual('大学列表。', 'University list.'))
});

export const universityDetailResponseSchema = z.object({
  university: universitySchema.describe(bilingual('大学详情。', 'University details.'))
});

export const organizationChangelogTypeSchema = z
  .enum(['university', 'club'])
  .describe(bilingual('变更目标类型。', 'Changelog target type.'));

export const organizationChangelogActionSchema = z
  .enum(['created', 'modified', 'deleted', 'campus_added', 'campus_updated', 'campus_deleted'])
  .describe(bilingual('变更动作。', 'Changelog action.'));

export const organizationChangelogFieldInfoSchema = z.object({
  field: z.string().describe(bilingual('字段名。', 'Field name.')),
  campusId: z.string().nullable().optional().describe(bilingual('校区 ID。', 'Campus ID.')),
  campusName: z.string().nullable().optional().describe(bilingual('校区名称。', 'Campus name.'))
});

export const organizationChangelogMetadataSchema = z
  .object({})
  .catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .describe(bilingual('附加元数据。', 'Additional metadata.'))
  .meta({ override: { type: 'object', additionalProperties: true } });

export const organizationChangelogEntrySchema = z.object({
  _id: z
    .union([z.string(), objectIdSchema])
    .optional()
    .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
  id: z.string().describe(bilingual('变更记录 ID。', 'Changelog entry ID.')),
  type: organizationChangelogTypeSchema,
  targetId: z.string().describe(bilingual('目标 ID。', 'Target ID.')),
  action: organizationChangelogActionSchema,
  fieldInfo: organizationChangelogFieldInfoSchema,
  oldValue: z.string().nullable().optional().describe(bilingual('旧值。', 'Old value.')),
  newValue: z.string().nullable().optional().describe(bilingual('新值。', 'New value.')),
  metadata: organizationChangelogMetadataSchema.optional(),
  userId: z.string().describe(bilingual('操作用户 ID。', 'Actor user ID.')),
  userName: z.string().nullable().optional().describe(bilingual('操作用户名。', 'Actor username.')),
  userImage: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('操作用户头像。', 'Actor avatar URL.')),
  createdAt: dateTimeSchema(bilingual('创建时间。', 'Creation time.')),
  user: userListItemSchema.optional().describe(bilingual('操作用户摘要。', 'Actor summary.'))
});

export const universityChangelogQuerySchema = z.object({
  page: positiveIntegerQueryParamSchema(
    bilingual('页数。默认为 1。', 'Page number. Defaults to 1.'),
    1
  ),
  limit: positiveIntegerQueryParamSchema(
    bilingual(
      '每页条目数。默认为站点分页大小，最大为 100。',
      'Items per page. Defaults to the site page size, up to 100.'
    ),
    20,
    100
  )
});

export const universityChangelogResponseSchema = z.object({
  entries: z
    .array(organizationChangelogEntrySchema)
    .describe(bilingual('变更记录列表。', 'Changelog entries.')),
  total: z.int().min(0).describe(bilingual('总条目数。', 'Total entries.')),
  page: z.int().min(1).describe(bilingual('当前页。', 'Current page.')),
  limit: z.int().min(1).max(100).describe(bilingual('每页条目数。', 'Items per page.')),
  hasMore: z.boolean().describe(bilingual('是否还有更多记录。', 'Whether more entries exist.')),
  totalPages: z.int().min(0).describe(bilingual('总页数。', 'Total pages.'))
});

export const universityMemberTypeSchema = z
  .enum(['student', 'moderator', 'admin'])
  .describe(bilingual('大学成员角色。', 'University membership role.'));

export const universityMemberSchema = z.object({
  _id: z
    .union([z.string(), objectIdSchema])
    .optional()
    .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
  id: z.string().describe(bilingual('成员关系 ID。', 'Membership ID.')),
  universityId: z.string().describe(bilingual('大学 ID。', 'University ID.')),
  userId: z.string().describe(bilingual('用户 ID。', 'User ID.')),
  memberType: universityMemberTypeSchema,
  verificationEmail: z.string().optional().describe(bilingual('认证邮箱。', 'Verification email.')),
  verifiedAt: dateTimeSchema(bilingual('认证时间。', 'Verification time.')).optional(),
  joinedAt: dateTimeSchema(bilingual('加入时间。', 'Join time.'))
});

export const universityMemberListEntrySchema = z.object({
  _id: z
    .union([z.string(), objectIdSchema])
    .optional()
    .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
  memberType: universityMemberTypeSchema,
  joinedAt: dateTimeSchema(bilingual('加入时间。', 'Join time.')),
  user: userListItemSchema.describe(bilingual('成员用户摘要。', 'Member user summary.'))
});

export const universityMembersQuerySchema = z.object({
  page: positiveIntegerQueryParamSchema(
    bilingual('页数。默认为 1。', 'Page number. Defaults to 1.'),
    1
  )
});

export const universityClubsQuerySchema = z.object({
  page: positiveIntegerQueryParamSchema(
    bilingual('页数。默认为 1。', 'Page number. Defaults to 1.'),
    1
  )
});

export const universityMembersResponseSchema = z.object({
  members: z
    .array(universityMemberListEntrySchema)
    .describe(bilingual('成员列表。', 'Member list.')),
  hasMore: z.boolean().describe(bilingual('是否还有更多成员。', 'Whether more members exist.')),
  page: z.int().min(1).describe(bilingual('当前页。', 'Current page.')),
  totalMembers: z.int().min(0).describe(bilingual('成员总数。', 'Total member count.'))
});

export const clubSchema = z
  .object({
    _id: z
      .union([z.string(), objectIdSchema])
      .optional()
      .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: z.string().describe(bilingual('社团 ID。', 'Club ID.')),
    universityId: z.string().describe(bilingual('所属大学 ID。', 'University ID.')),
    name: z.string().describe(bilingual('社团名称。', 'Club name.')),
    slug: z.string().optional().describe(bilingual('社团 slug。', 'Club slug.')),
    description: z.string().optional().describe(bilingual('社团简介。', 'Club description.')),
    avatarUrl: z.string().optional().describe(bilingual('社团头像 URL。', 'Club avatar URL.')),
    avatarImageId: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('社团头像图片资源 ID。', 'Club avatar image asset ID.')),
    backgroundColor: z.string().optional().describe(bilingual('背景色。', 'Background color.')),
    website: z.string().optional().describe(bilingual('社团网站。', 'Club website.')),
    acceptJoinRequests: z
      .boolean()
      .describe(bilingual('是否接受加入申请。', 'Whether join requests are accepted.')),
    postReadability: postReadabilitySchema,
    postWritability: postWritabilitySchema,
    membersCount: z.int().min(0).optional().describe(bilingual('成员数。', 'Member count.')),
    starredArcades: z
      .array(z.int())
      .describe(bilingual('收藏店铺 ID 列表。', 'Starred arcade IDs.')),
    createdAt: dateTimeSchema(bilingual('创建时间。', 'Creation time.')).optional(),
    updatedAt: dateTimeSchema(bilingual('更新时间。', 'Update time.')).optional(),
    createdBy: z.string().optional().describe(bilingual('创建者用户 ID。', 'Creator user ID.'))
  })
  .describe(bilingual('社团。', 'Club.'));

export const clubSummarySchema = clubSchema.pick({
  _id: true,
  id: true,
  name: true,
  description: true,
  slug: true,
  avatarUrl: true,
  createdAt: true,
  membersCount: true
});

export const universityClubListResponseSchema = z.object({
  clubs: z.array(clubSummarySchema).describe(bilingual('社团列表。', 'Club list.')),
  hasMore: z.boolean().describe(bilingual('是否还有更多社团。', 'Whether more clubs exist.')),
  page: z.int().min(1).describe(bilingual('当前页。', 'Current page.')),
  totalClubs: z.int().min(0).describe(bilingual('社团总数。', 'Total club count.'))
});

export const clubMemberTypeSchema = z
  .enum(['member', 'moderator', 'admin'])
  .describe(bilingual('社团成员角色。', 'Club membership role.'));

export const clubMemberSchema = z.object({
  _id: z
    .union([z.string(), objectIdSchema])
    .optional()
    .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
  id: z.string().describe(bilingual('成员关系 ID。', 'Membership ID.')),
  clubId: z.string().describe(bilingual('社团 ID。', 'Club ID.')),
  userId: z.string().describe(bilingual('用户 ID。', 'User ID.')),
  memberType: clubMemberTypeSchema,
  joinedAt: dateTimeSchema(bilingual('加入时间。', 'Join time.')),
  invitedBy: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('邀请者用户 ID。', 'Inviter user ID.'))
});

export const clubMemberListEntrySchema = z.object({
  _id: z
    .union([z.string(), objectIdSchema])
    .optional()
    .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
  memberType: clubMemberTypeSchema,
  joinedAt: dateTimeSchema(bilingual('加入时间。', 'Join time.')),
  user: userListItemSchema.describe(bilingual('成员用户摘要。', 'Member user summary.'))
});

export const clubsListQuerySchema = z.object({
  q: z.string().optional().default('').describe(bilingual('搜索关键词。', 'Search query.')),
  page: positiveIntegerQueryParamSchema(
    bilingual('页数。默认为 1。', 'Page number. Defaults to 1.'),
    1
  ),
  university: z
    .string()
    .optional()
    .default('')
    .describe(bilingual('大学筛选 ID。', 'University filter ID.'))
});

export const clubsListUniversityOptionSchema = z.object({
  id: z.string().describe(bilingual('大学 ID。', 'University ID.')),
  name: z.string().describe(bilingual('大学名称。', 'University name.'))
});

export const clubListItemSchema = clubSchema.extend({
  universityName: z.string().optional().describe(bilingual('大学名称。', 'University name.')),
  universityAvatarUrl: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('大学头像 URL。', 'University avatar URL.')),
  _rankingScore: z
    .number()
    .optional()
    .describe(bilingual('搜索排序分数。', 'Search ranking score.')),
  nameHl: z.string().optional().describe(bilingual('高亮名称。', 'Highlighted name.')),
  descriptionHl: z.string().optional().describe(bilingual('高亮简介。', 'Highlighted description.'))
});

export const clubsListResponseSchema = z.object({
  clubs: z.array(clubListItemSchema).describe(bilingual('社团列表。', 'Club list.')),
  universities: z
    .array(clubsListUniversityOptionSchema)
    .describe(bilingual('大学筛选项。', 'University filter options.')),
  totalCount: z.int().min(0).describe(bilingual('总社团数。', 'Total club count.')),
  currentPage: z.int().min(1).describe(bilingual('当前页。', 'Current page.')),
  hasNextPage: z.boolean().describe(bilingual('是否有下一页。', 'Whether a next page exists.')),
  hasPrevPage: z.boolean().describe(bilingual('是否有上一页。', 'Whether a previous page exists.')),
  query: z.string().describe(bilingual('当前查询。', 'Current search query.')),
  selectedUniversityId: z
    .string()
    .describe(bilingual('当前大学筛选 ID。', 'Selected university filter ID.'))
});

export const clubDetailStatsSchema = z.object({
  totalMembers: z.int().min(0).describe(bilingual('成员总数。', 'Total member count.'))
});

export const clubDetailResponseSchema = z.object({
  club: clubSchema.describe(bilingual('社团详情。', 'Club details.')),
  university: universitySummarySchema
    .nullable()
    .describe(bilingual('所属大学摘要。', 'Owning university summary.')),
  members: z.array(clubMemberListEntrySchema).describe(bilingual('成员列表。', 'Member list.')),
  starredArcades: z.array(shopSchema).describe(bilingual('收藏店铺列表。', 'Starred arcade list.')),
  stats: clubDetailStatsSchema,
  userPermissions: clubPermissionSchema.describe(
    bilingual('当前用户权限。', 'Current user permissions.')
  ),
  canWritePosts: z.boolean().describe(bilingual('是否可发帖。', 'Whether posting is allowed.'))
});

export const clubMembersQuerySchema = z.object({
  page: positiveIntegerQueryParamSchema(
    bilingual('页数。默认为 1。', 'Page number. Defaults to 1.'),
    1
  )
});

export const clubMembersResponseSchema = z.object({
  members: z.array(clubMemberListEntrySchema).describe(bilingual('成员列表。', 'Member list.')),
  hasMore: z.boolean().describe(bilingual('是否还有更多成员。', 'Whether more members exist.')),
  page: z.int().min(1).describe(bilingual('当前页。', 'Current page.')),
  totalMembers: z.int().min(0).describe(bilingual('成员总数。', 'Total member count.'))
});

export const clubArcadesQuerySchema = z.object({
  page: positiveIntegerQueryParamSchema(
    bilingual('页数。默认为 1。', 'Page number. Defaults to 1.'),
    1
  )
});

export const clubArcadesResponseSchema = z.object({
  arcades: z.array(shopSchema).describe(bilingual('店铺列表。', 'Arcade list.')),
  hasMore: z.boolean().describe(bilingual('是否还有更多店铺。', 'Whether more arcades exist.')),
  page: z.int().min(1).describe(bilingual('当前页。', 'Current page.')),
  total: z.int().min(0).describe(bilingual('店铺总数。', 'Total arcade count.'))
});

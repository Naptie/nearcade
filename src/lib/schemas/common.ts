import { z } from 'zod';

export const multilingual = (...messages: string[]) => messages.join('\n\n');

export const numericString = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .pipe(z.number());

export const integerString = numericString.pipe(z.int());

export const positiveIntegerString = integerString.pipe(z.int().positive());

export const shopIdParamSchema = z.object({
  id: positiveIntegerString.describe(multilingual('Shop ID.', '店铺 ID。'))
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
    .describe(multilingual('Page number. Defaults to 1.', '页数。默认为 1。')),
  limit: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
      const parsed = value === null || value === undefined || value === '' ? 0 : Number(value);
      return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    })
    .describe(
      multilingual(
        'Items per page. Defaults to the site page size.',
        '每页条目数。默认为站点分页大小。'
      )
    )
});

export const openingHourTimeSchema = z.object({
  hour: z
    .number()
    .transform((value) => Math.max(0, Math.min(23, Math.floor(value))))
    .describe(multilingual('Hour in 24-hour local time.', '24 小时制本地小时。'))
    .meta({ override: { type: 'integer', minimum: 0, maximum: 23 } }),
  minute: z
    .number()
    .transform((value) => Math.max(0, Math.min(59, Math.floor(value))))
    .describe(multilingual('Minute.', '分钟。'))
    .meta({ override: { type: 'integer', minimum: 0, maximum: 59 } })
});

export const openingHoursSchema = z
  .array(z.tuple([openingHourTimeSchema, openingHourTimeSchema]))
  .min(1)
  .describe(
    multilingual(
      'Opening hours. One item means the same hours for the whole week; seven items map to weekdays.',
      '营业时间。仅有 1 个元素时表示整周均为该营业时间；有 7 个元素时每个元素分别代表一周中的一天。'
    )
  );

export const locationSchema = z.object({
  type: z.literal('Point').describe(multilingual('GeoJSON geometry type.', 'GeoJSON 几何类型。')),
  coordinates: z
    .tuple([
      z.number().min(-180).max(180).describe(multilingual('Longitude.', '经度。')),
      z.number().min(-90).max(90).describe(multilingual('Latitude.', '纬度。'))
    ])
    .describe(
      multilingual(
        'GeoJSON coordinates in [longitude, latitude] order.',
        'GeoJSON 坐标，顺序为 [经度, 纬度]。'
      )
    )
});

export const successResponseSchema = z.object({
  success: z.boolean().describe(multilingual('Whether the operation succeeded.', '是否成功。'))
});

export const errorResponseSchema = z.object({
  error: z.string().optional().describe(multilingual('Error message.', '错误信息。')),
  message: z.string().optional().describe(multilingual('Error message.', '错误信息。'))
});

export const userPublicSchema = z.object({
  _id: z
    .string()
    .optional()
    .describe(multilingual('MongoDB ID. Use `id` in clients.', 'MongoDB ID。客户端请使用 id。')),
  id: z.string().describe(multilingual('User ID.', '用户 ID。')),
  name: z
    .string()
    .describe(
      multilingual('Username. Display with an @ prefix.', '用户名。展示时请在前面加 @ 符号。')
    ),
  email: z
    .string()
    .optional()
    .describe(
      multilingual(
        'Email address when the user has made it public.',
        '邮箱，仅在用户勾选“邮箱可见性”时存在。'
      )
    ),
  image: z.string().describe(multilingual('Avatar URL.', '头像。')),
  joinedAt: z.union([z.string(), z.date()]).describe(multilingual('Join time.', '加入时间。')),
  lastActiveAt: z
    .union([z.string(), z.date()])
    .describe(multilingual('Last active time.', '最后活跃时间。')),
  userType: z
    .enum([
      'site_admin',
      'school_admin',
      'school_moderator',
      'club_admin',
      'club_moderator',
      'student',
      'regular'
    ])
    .optional()
    .describe(multilingual('User type.', '用户类型。')),
  bio: z.string().describe(multilingual('User bio.', '个人简介。')),
  displayName: z
    .string()
    .nullable()
    .describe(
      multilingual(
        'Display name, preferred over `name` when present.',
        '用户示名，展示优先级高于 name。'
      )
    ),
  updatedAt: z
    .union([z.string(), z.date()])
    .describe(multilingual('Profile update time.', '资料更新时间。')),
  socialLinks: z
    .array(z.object({ platform: z.string(), username: z.string() }))
    .optional()
    .describe(multilingual('Social links visible to clients.', '社交链接。')),
  frequentingArcades: z
    .array(z.object({ id: z.int(), source: z.string().optional() }))
    .optional()
    .describe(
      multilingual(
        'Frequently visited arcades when made public.',
        '常去机厅，仅在用户勾选“常去机厅可见性”时存在。'
      )
    ),
  starredArcades: z
    .array(z.object({ id: z.int(), source: z.string().optional() }))
    .optional()
    .describe(
      multilingual(
        'Starred arcades when made public.',
        '收藏机厅，仅在用户勾选“收藏机厅可见性”时存在。'
      )
    )
});

export const parseSearchParams = <Schema extends z.ZodTypeAny>(schema: Schema, url: URL) => {
  return schema.parse(Object.fromEntries(url.searchParams));
};

export type OpeningHourTimeInput = z.infer<typeof openingHourTimeSchema>;

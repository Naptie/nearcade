import { z } from 'zod';
import { multilingual, optionalBooleanString } from './common';
import { shopSchema } from './shops';

export const discoverQuerySchema = z.object({
  longitude: z
    .union([z.string(), z.number()])
    .transform(Number)
    .pipe(z.number().min(-180).max(180))
    .describe(multilingual('Origin longitude.', '原点经度。')),
  latitude: z
    .union([z.string(), z.number()])
    .transform(Number)
    .pipe(z.number().min(-90).max(90))
    .describe(multilingual('Origin latitude.', '原点纬度。')),
  radius: z
    .union([z.string(), z.number(), z.undefined()])
    .transform((value) => (value === undefined || value === '' ? 10 : Number(value)))
    .pipe(z.number())
    .transform((value) => Math.max(1, Math.min(30, Math.floor(value))))
    .describe(
      multilingual('Search radius in kilometers. Defaults to 10.', '范围半径，单位 km；默认为 10。')
    ),
  name: z.string().optional().describe(multilingual('Origin display name.', '原点地名。')),
  fetchAttendance: optionalBooleanString
    .default(true)
    .describe(
      multilingual('Fetch attendance data. Defaults to true.', '是否获取在勤人数。默认为是。')
    ),
  includeTimeInfo: optionalBooleanString
    .default(true)
    .describe(
      multilingual(
        'Include computed timezone and open status. Defaults to true.',
        '是否包含时间信息（包括 timezone 与 isOpen）。默认为是。'
      )
    )
});

export const discoverShopSchema = shopSchema.extend({
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
      reporter: z.unknown(),
      comment: z.string().nullable()
    })
    .nullable()
    .optional()
    .describe(multilingual('Current attendance report.', '当前在勤人数报告。'))
});

export const discoverResponseSchema = z.object({
  shops: z.array(discoverShopSchema).describe(multilingual('Nearby shops.', '店铺列表。')),
  location: z
    .object({ name: z.string().nullable(), latitude: z.number(), longitude: z.number() })
    .describe(multilingual('Origin location.', '原点。')),
  radius: z.number().describe(multilingual('Search radius in kilometers.', '范围半径。'))
});

export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;

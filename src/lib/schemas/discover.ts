import { z } from 'zod';
import { bilingual, optionalBooleanString } from './common';
import { shopSchema } from './shops';

export const discoverQuerySchema = z.object({
  longitude: z
    .union([z.string(), z.number()])
    .transform(Number)
    .pipe(z.number().min(-180).max(180))
    .describe(bilingual('原点经度。', 'Origin longitude.')),
  latitude: z
    .union([z.string(), z.number()])
    .transform(Number)
    .pipe(z.number().min(-90).max(90))
    .describe(bilingual('原点纬度。', 'Origin latitude.')),
  radius: z
    .union([z.string(), z.number(), z.undefined()])
    .transform((value) => (value === undefined || value === '' ? 10 : Number(value)))
    .pipe(z.number())
    .transform((value) => Math.max(1, Math.min(30, Math.floor(value))))
    .describe(
      bilingual('范围半径，单位 km；默认为 10。', 'Search radius in kilometers. Defaults to 10.')
    ),
  name: z.string().optional().describe(bilingual('原点地名。', 'Origin display name.')),
  fetchAttendance: optionalBooleanString
    .default(true)
    .describe(
      bilingual('是否获取在勤人数。默认为是。', 'Fetch attendance data. Defaults to true.')
    ),
  includeTimeInfo: optionalBooleanString
    .default(true)
    .describe(
      bilingual('是否包含时间信息（包括 timezone 与 isOpen）。默认为是。', 'Include computed timezone and open status. Defaults to true.')
    )
});

export const discoverShopSchema = shopSchema.extend({
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
      reporter: z.unknown(),
      comment: z.string().nullable()
    })
    .nullable()
    .optional()
    .describe(bilingual('当前在勤人数报告。', 'Current attendance report.'))
});

export const discoverResponseSchema = z.object({
  shops: z.array(discoverShopSchema).describe(bilingual('店铺列表。', 'Nearby shops.')),
  location: z
    .object({ name: z.string().nullable(), latitude: z.number(), longitude: z.number() })
    .describe(bilingual('原点。', 'Origin location.')),
  radius: z.number().describe(bilingual('范围半径。', 'Search radius in kilometers.'))
});

export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;

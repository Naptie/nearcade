import { z } from 'zod';
import { bilingual, optionalBooleanString, positiveIntegerQueryParamSchema } from './common';
import {
  attendanceReportCommentSchema,
  gameAttendanceTotalSchema,
  includeTimeInfoSchema,
  partialAttendanceUserSchema,
  reportedAtSchema,
  reportedBySchema,
  shopSchema
} from './shops';
import { discoverMetroBlockSchema } from './metro';
import { MAX_DISCOVER_RESULTS, RADIUS_OPTIONS } from '$lib/constants';

/**
 * Snap an arbitrary radius to the closest supported search option (0 =
 * unlimited). Decimal radii from other pages (e.g. the metro ranking's
 * 0.2/0.5 km buckets) must never fall through — `Math.floor(0.2)` would
 * silently mean "unlimited".
 */
export const snapRadiusToOption = (km: number): number => {
  const clamped = Math.max(0, Math.min(30, km));
  if (clamped === 0) return 0;
  return RADIUS_OPTIONS.reduce(
    (best, option) => (Math.abs(option - clamped) < Math.abs(best - clamped) ? option : best),
    RADIUS_OPTIONS[0] as number
  );
};

export const discoverReportedAttendanceSchema = z
  .object({
    reportedAt: reportedAtSchema,
    reportedBy: reportedBySchema,
    reporter: partialAttendanceUserSchema,
    comment: attendanceReportCommentSchema
  })
  .describe(bilingual('当前在勤人数报告。', 'Current attendance report.'))
  .nullable();

export const discoverGameSchema = shopSchema.shape.games.element.extend({
  totalAttendance: gameAttendanceTotalSchema.optional()
});

export const convertFromSchema = z
  .string()
  .optional()
  .transform((v) => v || undefined)
  .pipe(z.enum(['gps', 'mapbar', 'baidu']).optional())
  .describe(
    bilingual(
      '原始坐标系。可选值：gps（WGS-84）、mapbar、baidu。',
      'Source coordinate system to convert from. Options: gps (WGS-84), mapbar, baidu.'
    )
  );

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
    .optional()
    .transform((value) => (value === undefined || value === '' ? 10 : Number(value)))
    .pipe(z.number())
    .transform(snapRadiusToOption)
    .describe(
      bilingual(
        '范围半径，单位 km；0 表示无限制。默认为 10。任意值会吸附到最近的受支持选项。',
        'Search radius in kilometers; 0 means unlimited. Defaults to 10. Arbitrary values snap to the closest supported option.'
      )
    ),
  limit: positiveIntegerQueryParamSchema(
    bilingual(
      `结果数量限制；最小为 1，最大为 ${MAX_DISCOVER_RESULTS}。默认为 ${MAX_DISCOVER_RESULTS}。`,
      `Result count limit; minimum is 1, maximum is ${MAX_DISCOVER_RESULTS}. Defaults to ${MAX_DISCOVER_RESULTS}.`
    ),
    MAX_DISCOVER_RESULTS,
    MAX_DISCOVER_RESULTS
  ),
  gameTitleIds: z
    .union([z.string(), z.array(z.number()), z.undefined()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return undefined;
      if (Array.isArray(value)) return value;
      return value
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((v) => !isNaN(v));
    })
    .pipe(z.array(z.number()).optional())
    .describe(
      bilingual(
        '按游戏标题 ID 筛选，以逗号分隔。仅返回包含所有指定游戏的店铺。',
        'Filter by game title IDs, comma-separated. Only shops with all specified games are returned.'
      )
    ),
  name: z.string().optional().describe(bilingual('原点地名。', 'Origin display name.')),
  fetchAttendance: optionalBooleanString
    .default(true)
    .describe(
      bilingual('是否获取在勤人数。默认为是。', 'Fetch attendance data. Defaults to true.')
    ),
  includeTimeInfo: includeTimeInfoSchema,
  convertFrom: convertFromSchema
});

/**
 * A shop's metro travel estimate. Present **only** when riding the network
 * beats walking the straight-line distance between at least two stations —
 * the only trip we can time credibly. Shops without a worthwhile metro trip
 * carry no `travel` at all, exactly as before metro existed, because a
 * straight-line distance cannot support a credible walk/ride time.
 */
export const shopTravelEstimateSchema = z
  .object({
    seconds: z
      .number()
      .int()
      .min(0)
      .describe(bilingual('门到门地铁耗时（秒）。', 'Door-to-door metro seconds.')),
    metroSeconds: z
      .number()
      .int()
      .min(0)
      .describe(bilingual('地铁在途耗时（秒）。', 'In-system metro seconds.'))
  })
  .describe(
    bilingual(
      '地铁到达方式与耗时（仅当快于直线步行时给出）。',
      'Metro arrival time, present only when faster than walking the straight line.'
    )
  );

export const discoverShopSchema = shopSchema.extend({
  games: z
    .array(discoverGameSchema)
    .describe(bilingual('附近店铺的机台列表。', 'Games available at the nearby shop.')),
  distance: z
    .number()
    .describe(bilingual('店铺距离，单位 km。', 'Distance from the origin in kilometers.')),
  travel: shopTravelEstimateSchema
    .optional()
    .describe(
      bilingual(
        '地铁到达方式与耗时；无地铁优势时省略。',
        'Metro arrival time; omitted when the metro offers no advantage.'
      )
    ),
  totalAttendance: z
    .int()
    .min(0)
    .optional()
    .describe(bilingual('店铺综合在勤人数。', 'Combined shop attendance count.')),
  currentReportedAttendance: discoverReportedAttendanceSchema
    .optional()
    .describe(bilingual('当前在勤人数报告。', 'Current attendance report.'))
});

export const discoverResponseSchema = z.object({
  shops: z.array(discoverShopSchema).describe(bilingual('店铺列表。', 'Nearby shops.')),
  location: z
    .object({
      name: z.string().nullable().describe(bilingual('原点地名。', 'Origin display name.')),
      latitude: z.number().describe(bilingual('原点纬度。', 'Origin latitude.')),
      longitude: z.number().describe(bilingual('原点经度。', 'Origin longitude.'))
    })
    .describe(bilingual('原点。', 'Origin location.')),
  radius: z.number().describe(bilingual('范围半径。', 'Search radius in kilometers.')),
  limit: z.number().optional().describe(bilingual('结果数量限制。', 'Result count limit.')),
  gameTitleIds: z
    .array(z.number())
    .optional()
    .describe(bilingual('游戏标题筛选。', 'Game title filter.')),
  metro: discoverMetroBlockSchema
    .optional()
    .describe(
      bilingual(
        '地铁行程信息块（原点 3 km 内有车站，且至少一家返回店铺的最快方式是地铁时出现）。',
        'Metro itinerary block (present when the origin snaps to a station and ≥1 returned shop is fastest reached by metro).'
      )
    )
});

export type DiscoverResponse = z.infer<typeof discoverResponseSchema>;

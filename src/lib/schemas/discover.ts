import { z } from 'zod';
import { bilingual, optionalBooleanString } from './common';
import {
  attendanceReportCommentSchema,
  gameAttendanceTotalSchema,
  includeTimeInfoSchema,
  partialAttendanceUserSchema,
  reportedAtSchema,
  reportedBySchema,
  shopSchema
} from './shops';
import { MAX_DISCOVER_RESULTS } from '$lib/constants';

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
    .transform((value) => Math.max(0, Math.min(30, Math.floor(value))))
    .describe(
      bilingual(
        '范围半径，单位 km；0 表示无限制。默认为 10。',
        'Search radius in kilometers; 0 means unlimited. Defaults to 10.'
      )
    ),
  limit: z
    .union([z.string(), z.number(), z.undefined()])
    .optional()
    .transform((value) =>
      value === undefined || value === '' ? MAX_DISCOVER_RESULTS : Number(value)
    )
    .pipe(z.number())
    .transform((value) => Math.max(1, Math.min(MAX_DISCOVER_RESULTS, Math.floor(value))))
    .describe(
      bilingual(
        `结果数量限制；最小为 1，最大为 ${MAX_DISCOVER_RESULTS}。默认为 ${MAX_DISCOVER_RESULTS}。`,
        `Result count limit; minimum is 1, maximum is ${MAX_DISCOVER_RESULTS}. Defaults to ${MAX_DISCOVER_RESULTS}.`
      )
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

export const discoverShopSchema = shopSchema.extend({
  games: z
    .array(discoverGameSchema)
    .describe(bilingual('附近店铺的机台列表。', 'Games available at the nearby shop.')),
  distance: z
    .number()
    .describe(bilingual('店铺距离，单位 km。', 'Distance from the origin in kilometers.')),
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
    .describe(bilingual('游戏标题筛选。', 'Game title filter.'))
});

export type DiscoverResponse = z.infer<typeof discoverResponseSchema>;

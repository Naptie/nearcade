import { z } from 'zod';
import { bilingual, locationSchema } from './common';

/**
 * Per-radius metrics for POI-based rankings (campus, metro station).
 *
 * The rankings table renders this shape for every radius column, and metro
 * ranking responses validate their embedded rows with it.
 */
export const rankingMetricsSchema = z.object({
  radius: z.number().describe(bilingual('统计半径（km）。', 'Metrics radius in km.')),
  shopCount: z.number().int().describe(bilingual('半径内店铺数。', 'Shops within the radius.')),
  totalMachines: z
    .number()
    .int()
    .describe(bilingual('半径内机台总数。', 'Total machines within the radius.')),
  areaDensity: z
    .number()
    .nullable()
    .describe(
      bilingual(
        '每平方公里机台数（区域面积缺失时为 null）。',
        'Machines per km² (null when the area is unavailable).'
      )
    ),
  machinesPerCapita: z
    .number()
    .nullable()
    .describe(
      bilingual(
        '每万人机台数（人口缺失时为 null）。',
        'Machines per 10,000 people (null when the population is unavailable).'
      )
    ),
  gameSpecificMachines: z
    .array(z.object({ name: z.string(), quantity: z.number().int() }))
    .describe(bilingual('各游戏标题的机台数。', 'Machine count per game title.'))
});

export type RankingMetrics = z.infer<typeof rankingMetricsSchema>;

/**
 * A campus ranking row.
 *
 * The campus page renders exactly these fields. The tied display rank (`rank`)
 * is resolved from the stored `ranks` map for the requested sort key.
 */
export const campusRankingItemSchema = z.object({
  id: z.string().describe(bilingual('校区 ID。', 'Campus ID.')),
  universityName: z.string().describe(bilingual('大学名称。', 'University name.')),
  campusName: z.string().nullable().describe(bilingual('校区名称。', 'Campus name.')),
  fullName: z.string().describe(bilingual('完整名称。', 'Full name.')),
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
  province: z.string().describe(bilingual('省份。', 'Province.')),
  city: z.string().describe(bilingual('城市。', 'City.')),
  district: z.string().nullable().describe(bilingual('区县。', 'District.')),
  address: z.string().describe(bilingual('详细地址。', 'Detailed address.')),
  location: locationSchema.describe(bilingual('校区坐标。', 'Campus coordinates.')),
  rankings: z
    .array(rankingMetricsSchema)
    .describe(bilingual('各半径下的指标。', 'Metrics per radius.')),
  rank: z
    .number()
    .nullable()
    .describe(
      bilingual(
        '当前维度与半径下的全局并列名次；缓存早于该字段时为 null。',
        'Global tied rank for the requested sort key and radius; null when the cache predates the field.'
      )
    )
});

export type UniversityRankingData = z.infer<typeof campusRankingItemSchema>;

/** A region ranking row. */
export const regionRankingItemSchema = z.object({
  id: z.string().describe(bilingual('地区 ID。', 'Region ID.')),
  level: z
    .enum(['country', 'province', 'city', 'county', 'street'])
    .describe(bilingual('地区层级。', 'Region level.')),
  name: z.string().describe(bilingual('地区名称。', 'Region name.')),
  country: z.string().nullable().describe(bilingual('国家地区 ID。', 'Country region ID.')),
  province: z.string().nullable().describe(bilingual('省份地区 ID。', 'Province region ID.')),
  city: z.string().nullable().describe(bilingual('城市地区 ID。', 'City region ID.')),
  county: z.string().nullable().describe(bilingual('区县地区 ID。', 'County region ID.')),
  regionChain: z
    .array(
      z.object({
        id: z.string().describe(bilingual('地区 ID。', 'Region ID.')),
        name: z
          .record(z.string(), z.string())
          .describe(bilingual('多语言名称。', 'Multilingual names.'))
      })
    )
    .optional()
    .describe(bilingual('完整地区层级（根到自身）。', 'Full region hierarchy (root to self).')),
  location: locationSchema.describe(bilingual('地区坐标。', 'Region coordinates.')),
  area: z.number().nullable().describe(bilingual('面积（km²）。', 'Area in km².')),
  population: z.number().nullable().describe(bilingual('人口。', 'Population.')),
  shopCount: z.number().describe(bilingual('店铺数。', 'Shop count.')),
  totalMachines: z.number().describe(bilingual('机台总数。', 'Total machine count.')),
  areaDensity: z.number().nullable().describe(bilingual('每平方公里机台数。', 'Machines per km².')),
  machinesPerCapita: z
    .number()
    .nullable()
    .describe(bilingual('每万人机台数。', 'Machines per 10,000 people.')),
  gameSpecificMachines: z
    .array(z.object({ name: z.string(), quantity: z.number().int() }))
    .describe(bilingual('各游戏标题的机台数。', 'Machine count per game title.')),
  rank: z
    .number()
    .nullable()
    .describe(
      bilingual(
        '当前维度下的全局并列名次；缓存早于该字段时为 null。',
        'Global tied rank for the requested sort key; null when the cache predates the field.'
      )
    )
});

export type RegionRankingData = z.infer<typeof regionRankingItemSchema>;

/** The level of a region row, taken from the row schema so the two cannot drift. */
export type RegionLevel = z.infer<typeof regionRankingItemSchema>['level'];

/**
 * The envelope every ranking response shares.
 *
 * Only the `data` item differs between the campus and the region leaderboard,
 * so the pagination and cache fields live here once.
 *
 * `cacheTime` is nullable *and* required, which is not an accident: the API
 * answers `null` from the branches that have no cache metadata yet (see the
 * `cacheTime: null` returns in `implementations/rankings.ts`), and every reader
 * handles it — the three ranking page servers all do
 * `result.cacheTime ? new Date(result.cacheTime) : new Date()`. The published
 * document says `nullable: true` as well. Do not narrow it to a plain string.
 */
export const rankingResponseEnvelopeShape = {
  totalCount: z.number().describe(bilingual('总条目数。', 'Total row count.')),
  hasMore: z.boolean().describe(bilingual('是否还有更多条目。', 'Whether more rows exist.')),
  nextCursor: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('下一页游标。', 'Cursor of the next page.')),
  cached: z
    .boolean()
    .describe(bilingual('是否来自缓存。', 'Whether the response came from the cache.')),
  cacheTime: z.iso.datetime().nullable().describe(bilingual('缓存时间。', 'Cache time.')),
  stale: z.boolean().describe(bilingual('缓存是否已过期。', 'Whether the cache is stale.')),
  calculating: z
    .boolean()
    .optional()
    .describe(bilingual('是否正在重新计算。', 'Whether a recalculation is running.'))
};

export const campusRankingResponseSchema = z.object({
  data: z.array(campusRankingItemSchema).describe(bilingual('排名条目。', 'Ranking rows.')),
  ...rankingResponseEnvelopeShape
});

export const regionRankingResponseSchema = z.object({
  data: z.array(regionRankingItemSchema).describe(bilingual('排名条目。', 'Ranking rows.')),
  ...rankingResponseEnvelopeShape
});

export type UniversityRankingResponse = z.infer<typeof campusRankingResponseSchema>;
export type RegionRankingResponse = z.infer<typeof regionRankingResponseSchema>;

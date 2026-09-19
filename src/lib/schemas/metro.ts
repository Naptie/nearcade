import { z } from 'zod';
import { GAME_TITLES, METRO_RANKING_RADIUS_OPTIONS, PAGINATION } from '$lib/constants';
import { bilingual, positiveIntegerQueryParamSchema } from './common';
import { rankingMetricsSchema } from './rankings';

export const metroLineBadgeSchema = z.object({
  id: z.string().describe(bilingual('线路 ID。', 'Line ID.')),
  name: z.string().describe(bilingual('线路名称。', 'Line name.')),
  // openmetro's ApiNames contract: zh + en are both mandatory on every entity.
  names: z
    .object({ zh: z.string(), en: z.string() })
    .describe(bilingual('线路多语名称。', 'Multilingual line names.')),
  color: z.string().nullable().describe(bilingual('线路官方色值。', 'Official line color.')),
  shortName: z.string().describe(bilingual('线路官方短号。', 'Official compact line code.'))
});

export const shopMetroSchema = z
  .object({
    networkId: z.string().describe(bilingual('所属地铁网络 ID。', 'Metro network ID.')),
    stationId: z.string().describe(bilingual('最近地铁站 ID。', 'Nearest metro station ID.')),
    stationName: z.string().describe(bilingual('最近地铁站名称。', 'Nearest metro station name.')),
    names: z
      .object({ zh: z.string(), en: z.string() })
      .describe(
        bilingual('最近地铁站多语名称。', 'Multilingual names of the nearest metro station.')
      ),
    walkSeconds: z
      .number()
      .int()
      .min(0)
      .describe(
        bilingual('店铺到站点的步行时间（秒）。', 'Walking seconds from the shop to the station.')
      ),
    distanceKm: z
      .number()
      .min(0)
      .describe(
        bilingual(
          '店铺到站点的直线距离（km）。',
          'Straight-line distance from the shop to the station in km.'
        )
      ),
    lines: z
      .array(metroLineBadgeSchema)
      .describe(bilingual('站点所属线路。', 'Lines serving the station.'))
  })
  .describe(bilingual('店铺关联的地铁站信息。', 'Metro station assignment for the shop.'));

export type ShopMetro = z.infer<typeof shopMetroSchema>;

/**
 * General transit container on the shop document (交通信息). Mode-specific
 * assignments live under their own key so future modes (bus, rail, …) can be
 * added without touching the shop's top-level shape.
 */
export const shopTransitSchema = z
  .object({
    metro: shopMetroSchema
      .optional()
      .describe(bilingual('店铺关联的地铁站信息。', 'Metro station assignment for the shop.'))
  })
  .describe(bilingual('店铺的交通信息。', 'Transit information for the shop.'));

export type ShopTransit = z.infer<typeof shopTransitSchema>;

// ── Discover response metro block (§3.4 of the integration plan) ────────────

export const metroLegPlanSchema = z.object({
  kind: z
    .enum(['ride', 'transfer'])
    .describe(bilingual('路段类型：乘车或换乘。', 'Leg kind: ride or transfer.')),
  lineId: z
    .string()
    .optional()
    .describe(bilingual('乘车路段的线路 ID。', 'Line ID for ride legs.')),
  stationIds: z
    .array(z.string())
    .describe(
      bilingual(
        '途经站点 ID（乘车路段含首末站）。',
        'Station ids visited in order (ride legs include both endpoints).'
      )
    ),
  seconds: z
    .number()
    .int()
    .min(0)
    .describe(bilingual('路段耗时（秒）。', 'Leg duration in seconds.')),
  distanceKm: z
    .number()
    .min(0)
    .optional()
    .describe(bilingual('路段距离（km）。', 'Leg distance in km.')),
  direction: z
    .string()
    .optional()
    .describe(
      bilingual('乘车路段方向（终点站名）。', 'Ride leg direction (terminal station name).')
    )
});

export const metroShopItinerarySchema = z.object({
  totalSeconds: z
    .number()
    .int()
    .min(0)
    .describe(
      bilingual(
        '总耗时（秒）＝ 步行进站 + 进站开销 + 在途 + 出站开销 + 步行到店。',
        'Total travel seconds = access walk + entry overhead + in-system + exit overhead + egress walk.'
      )
    ),
  rideSeconds: z
    .number()
    .int()
    .min(0)
    .describe(bilingual('乘车路段总耗时（秒）。', 'Total ride-leg seconds.')),
  transferCount: z.number().int().min(0).describe(bilingual('换乘次数。', 'Number of transfers.')),
  legs: z
    .array(metroLegPlanSchema)
    .describe(bilingual('行程路段列表。', 'Itinerary legs in order.'))
});

export const discoverMetroBlockSchema = z.object({
  network: z
    .object({
      id: z.string().describe(bilingual('地铁网络 ID。', 'Metro network ID.')),
      name: z.string().describe(bilingual('地铁网络名称。', 'Metro network name.')),
      names: z
        .object({ zh: z.string(), en: z.string() })
        .describe(bilingual('地铁网络多语名称。', 'Multilingual network names.')),
      cityRegionId: z.string().describe(bilingual('城市区域 ID。', 'City region ID.'))
    })
    .describe(bilingual('原点车站所属网络。', 'Network of the origin station.')),
  origin: z
    .object({
      stationId: z.string().describe(bilingual('原点车站 ID。', 'Origin station ID.')),
      stationName: z.string().describe(bilingual('原点车站名称。', 'Origin station name.')),
      names: z
        .object({ zh: z.string(), en: z.string() })
        .describe(bilingual('原点车站多语名称。', 'Multilingual origin-station names.')),
      walkSeconds: z
        .number()
        .int()
        .min(0)
        .describe(
          bilingual('原点到车站的步行时间（秒）。', 'Walk seconds from origin to station.')
        ),
      lon: z.number().describe(bilingual('搜索原点经度。', 'Search-origin longitude.')),
      lat: z.number().describe(bilingual('搜索原点纬度。', 'Search-origin latitude.'))
    })
    .describe(bilingual('原点进站信息。', 'Origin station entry info.')),
  lines: z
    .record(z.string(), metroLineBadgeSchema)
    .describe(bilingual('行程涉及的线路。', 'Referenced lines in itineraries.')),
  stations: z
    .record(
      z.string(),
      z.object({
        name: z.string().describe(bilingual('站点名称。', 'Station name.')),
        names: z
          .object({ zh: z.string(), en: z.string() })
          .describe(bilingual('站点多语名称。', 'Multilingual station names.')),
        lon: z.number().describe(bilingual('站点经度。', 'Station longitude.')),
        lat: z.number().describe(bilingual('站点纬度。', 'Station latitude.'))
      })
    )
    .describe(bilingual('行程涉及的站点。', 'Referenced stations in itineraries.')),
  shops: z
    .record(z.string(), metroShopItinerarySchema)
    .describe(bilingual('各店铺的行程。', 'Itineraries for each shop.'))
});

export type MetroLegPlan = z.infer<typeof metroLegPlanSchema>;
export type MetroShopItinerary = z.infer<typeof metroShopItinerarySchema>;
export type DiscoverMetroBlock = z.infer<typeof discoverMetroBlockSchema>;

// ── Station rankings (§3.6, campus-parity model) ────────────────────────────
// Metro stations are POI-based discovery, identical in shape to campus
// rankings: every row carries per-radius metrics (METRO_RANKING_RADIUS_OPTIONS,
// 200 m up to the METRO_ACCESS_MAX_KM snapping cutoff) and rank positions
// keyed `${sortBy}_${radius}`. All buckets are straight-line caches computed
// in the sync task from existing assignments.

export const metroStationRankingSchema = z.object({
  /** Shared-row key used by the rankings table components (`RankingsTableItem`). */
  _id: z.string().describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
  id: z.string().describe(bilingual('`{networkId}:{stationId}`。', '`{networkId}:{stationId}`.')),
  networkId: z.string().describe(bilingual('地铁网络 ID。', 'Metro network ID.')),
  stationId: z.string().describe(bilingual('地铁站 ID。', 'Metro station ID.')),
  name: z.string().describe(bilingual('地铁站名称。', 'Metro station name.')),
  names: z
    .object({ zh: z.string(), en: z.string() })
    .describe(bilingual('地铁站多语名称。', 'Multilingual station names.')),
  lines: z
    .array(metroLineBadgeSchema)
    .describe(bilingual('站点所属线路。', 'Lines serving the station.')),
  location: z
    .object({ lon: z.number(), lat: z.number() })
    .describe(bilingual('站点坐标。', 'Station coordinates.')),
  rankings: z
    .array(rankingMetricsSchema)
    .describe(bilingual('各半径下的指标。', 'Metrics per radius.')),
  rankOrder: z
    .record(z.string(), z.number().int())
    .describe(bilingual('各“维度——半径”组合下的名次。', 'Rank position per `sortBy_radius` key.'))
});

export type MetroStationRanking = z.infer<typeof metroStationRankingSchema>;

const metroRankingCursorSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((value) => Number.isSafeInteger(Number(value)), 'Cursor must be a positive safe integer');

export const metroRankingQuerySchema = z.object({
  networkId: z
    .string()
    .trim()
    .regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/)
    .transform((value) => value || undefined)
    .optional()
    .describe(
      bilingual(
        '按网络 ID 筛选；空白表示所有网络。',
        'Filter by network ID; blank means all networks.'
      )
    ),
  sortBy: z
    .enum(['shops', 'machines', ...GAME_TITLES.map((game) => game.key)])
    .default('shops')
    .describe(bilingual('排序维度。默认 shops。', 'Sort key. Defaults to shops.')),
  radius: z
    .string()
    .optional()
    .transform((value, ctx) => {
      // Blank/absent defaults to the snapping cutoff (2 km), the widest
      // bucket — same idea as the campus page defaulting to its middle option.
      const normalized = value?.trim() || String(METRO_RANKING_RADIUS_OPTIONS.at(-1));
      const match = METRO_RANKING_RADIUS_OPTIONS.find((radius) => String(radius) === normalized);
      if (match === undefined) {
        ctx.addIssue({
          code: 'invalid_value',
          values: METRO_RANKING_RADIUS_OPTIONS.map(String) as [string, ...string[]],
          message: `Invalid option: expected one of ${METRO_RANKING_RADIUS_OPTIONS.map((r) => `"${r}"`).join('|')}`
        });
        return z.NEVER;
      }
      return match as (typeof METRO_RANKING_RADIUS_OPTIONS)[number];
    })
    .describe(bilingual('统计半径（km）。默认 2。', 'Metrics radius in km. Defaults to 2.')),
  limit: positiveIntegerQueryParamSchema(
    bilingual('每页条目数，最大 100。', 'Items per page, up to 100.'),
    PAGINATION.RANKING_PAGE_SIZE,
    100
  ),
  after: metroRankingCursorSchema
    .optional()
    .describe(
      bilingual(
        '上一页的最后返回条目的全局名次。',
        'Global rank of the last returned station on the previous page.'
      )
    )
});

export const metroRankingResponseSchema = z.object({
  data: z.array(metroStationRankingSchema),
  totalCount: z
    .int()
    .nonnegative()
    .describe(
      bilingual('所选网络与半径的总条目数。', 'Total matching stations for the network and radius.')
    ),
  hasMore: z.boolean(),
  nextCursor: metroRankingCursorSchema
    .nullable()
    .describe(
      bilingual(
        '最后返回条目的全局名次；无下一页时为 null。',
        'Global rank of the last returned station; null when there is no next page.'
      )
    ),
  cached: z.boolean(),
  cacheTime: z.iso.datetime().nullable(),
  stale: z.boolean(),
  calculating: z.boolean(),
  networks: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        // openmetro's ApiNames contract: zh + en are both mandatory.
        names: z.object({ zh: z.string(), en: z.string() }),
        stationCount: z.int().nonnegative()
      })
    )
    .describe(bilingual('完整地铁网络列表。', 'Full metro network list.'))
});

export type MetroRankingResponse = z.infer<typeof metroRankingResponseSchema>;

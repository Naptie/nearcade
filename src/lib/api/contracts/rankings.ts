import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual } from '$lib/schemas/common';
import { campusRankingResponseSchema, regionRankingResponseSchema } from '$lib/schemas/rankings';
import { metroRankingQuerySchema, metroRankingResponseSchema } from '$lib/schemas/metro';

export const rankingsContract = {
  /** `GET /api/rankings/campus` — campus leaderboards read from the cache. */
  campus: definePublic({
    method: 'GET',
    path: '/rankings/campus',
    operationId: 'getRankingsCampus',
    tags: ['rankings'],
    scope: 'open',
    summary: bilingual('获取校区排名', 'Get campus rankings', true),
    description: bilingual(
      '读取持久化的校区排名，不触发同步。按所选维度与半径的全局顺序号升序分页，筛选半径外的条目。',
      'Read persisted campus rankings without triggering a sync. Paginate by ascending global order position for the selected sort key and radius.'
    )
  })
    .input(
      z.object({
        sortBy: z
          .string()
          .optional()
          .describe(
            bilingual(
              '排序维度。无效值回退为 shops。',
              'Sort key. Invalid values fall back to shops.'
            )
          ),
        radius: z
          .string()
          .optional()
          .describe(
            bilingual('统计半径（km）。默认为 10。', 'Metrics radius in km. Defaults to 10.')
          ),
        limit: z
          .string()
          .optional()
          .describe(bilingual('每页条目数。默认为 24。', 'Items per page. Defaults to 24.')),
        after: z
          .string()
          .optional()
          .describe(
            bilingual(
              '游标：上一页最后条目的全局顺序号（`rankOrder`，唯一序号，非展示名次 `rank`）。',
              'Cursor: global order position (`rankOrder`, the unique ordinal — not the display rank `rank`) of the last returned row on the previous page.'
            )
          )
      })
    )
    .output(campusRankingResponseSchema),

  /** `GET /api/rankings/metro` — metro station leaderboards read from the cache. */
  metro: definePublic({
    method: 'GET',
    path: '/rankings/metro',
    operationId: 'getRankingsMetro',
    tags: ['rankings'],
    scope: 'open',
    summary: bilingual('获取地铁站排名', 'Get metro station rankings', true),
    description: bilingual(
      '读取持久化的地铁站排名，不触发同步或 API 调用。按所选维度与半径的全局顺序号升序分页（rankOrder 键为 维度_半径）；筛选网络后保留全局名次。每个条目同时携带当前维度下的全局并列名次 rank（指标相同的条目并列）。',
      'Read persisted metro station rankings without triggering sync or API calls. Paginate by ascending global order position for the selected sort key and radius (rankOrder key `sortBy_radius`); network filtering preserves global ranks. Each item also carries `rank`, the global tied rank for the requested sort (equal metrics share a rank).'
    )
  })
    .input(metroRankingQuerySchema)
    .output(metroRankingResponseSchema),

  /** `GET /api/rankings/region` — region leaderboards read from the cache. */
  region: definePublic({
    method: 'GET',
    path: '/rankings/region',
    operationId: 'getRankingsRegion',
    tags: ['rankings'],
    scope: 'open',
    summary: bilingual('获取地区排名', 'Get region rankings', true),
    description: bilingual(
      '读取持久化的地区排名，不触发同步。按所选维度的全局顺序号升序分页；区县层级包含街道级条目。',
      'Read persisted region rankings without triggering a sync. Paginate by ascending global order position for the selected sort key; the county level includes street-level rows.'
    )
  })
    .input(
      z.object({
        sortBy: z
          .string()
          .optional()
          .describe(bilingual('排序维度。默认为 shops。', 'Sort key. Defaults to shops.')),
        level: z
          .string()
          .optional()
          .describe(
            bilingual(
              '地区层级：country、province、city、county、street。默认为 country。',
              'Region level: country, province, city, county or street. Defaults to country.'
            )
          ),
        limit: z
          .string()
          .optional()
          .describe(bilingual('每页条目数。默认为 24。', 'Items per page. Defaults to 24.')),
        after: z
          .string()
          .optional()
          .describe(
            bilingual(
              '游标：上一页最后条目的全局顺序号（`rankOrder`，唯一序号，非展示名次 `rank`）。',
              'Cursor: global order position (`rankOrder`, the unique ordinal — not the display rank `rank`) of the last returned row on the previous page.'
            )
          )
      })
    )
    .output(regionRankingResponseSchema)
};

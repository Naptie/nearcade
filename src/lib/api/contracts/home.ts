import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual } from '$lib/schemas/common';
import { shopChangelogListResponseSchema, shopChangelogQuerySchema } from '$lib/schemas/shops';

/** A region leaderboard entry — the shop or machine count of one region. */
const homeStatsRegionEntrySchema = z.object({
  id: z.string().describe(bilingual('地区 ID。', 'Region ID.')),
  name: z.string().describe(bilingual('地区名称。', 'Region name.')),
  parentName: z.string().nullable().describe(bilingual('上级地区名称。', 'Parent region name.')),
  value: z.number().describe(bilingual('数值。', 'Value.')),
  rank: z.number().nullable().describe(bilingual('排名。', 'Rank.'))
});

/** A campus leaderboard entry. */
const homeStatsCampusEntrySchema = z.object({
  id: z.string().describe(bilingual('校区 ID。', 'Campus ID.')),
  name: z.string().describe(bilingual('校区名称。', 'Campus name.')),
  value: z.number().describe(bilingual('数值。', 'Value.')),
  rank: z.number().nullable().describe(bilingual('排名。', 'Rank.'))
});

/** A metro station leaderboard entry. */
const homeStatsMetroEntrySchema = z.object({
  id: z.string().describe(bilingual('站点 ID。', 'Station ID.')),
  name: z.string().describe(bilingual('站点名称。', 'Station name.')),
  sublabel: z.string().nullable().describe(bilingual('线路名称。', 'Network name.')),
  lat: z.number().describe(bilingual('纬度。', 'Latitude.')),
  lon: z.number().describe(bilingual('经度。', 'Longitude.')),
  value: z.number().describe(bilingual('数值。', 'Value.')),
  rank: z.number().nullable().describe(bilingual('排名。', 'Rank.'))
});

/** The leaderboards of one dimension, keyed by its radius. */
const homeStatsCampusSchema = z.record(
  z.string(),
  z.object({
    shops: z.array(homeStatsCampusEntrySchema),
    machines: z.array(homeStatsCampusEntrySchema)
  })
);

/** The leaderboards of one dimension, keyed by its radius. */
const homeStatsMetroSchema = z.record(
  z.string(),
  z.object({
    shops: z.array(homeStatsMetroEntrySchema),
    machines: z.array(homeStatsMetroEntrySchema)
  })
);

export const homeContract = {
  /** `GET /api/home/changelog` — the most recent shop changelog entries. */
  changelog: definePublic({
    method: 'GET',
    path: '/home/changelog',
    operationId: 'getHomeChangelog',
    tags: ['home'],
    scope: 'open',
    summary: bilingual('获取最近的店铺更新记录。', 'Get the recent shop changelog.', true),
    description: bilingual(
      '返回最近的店铺更新记录，按时间倒序分页。',
      'Returns the most recent shop changelog entries, newest first, paginated.'
    )
  })
    .input(shopChangelogQuerySchema)
    .output(shopChangelogListResponseSchema),

  /** `GET /api/home/stats` — the counters and leaderboards of the landing page. */
  stats: definePublic({
    method: 'GET',
    path: '/home/stats',
    operationId: 'getHomeStats',
    tags: ['home'],
    scope: 'open',
    summary: bilingual('获取首页统计。', 'Get the home page statistics.', true),
    description: bilingual(
      '返回首页展示的总数与排行榜：地区、校区与地铁站维度的店铺数与机台数。',
      'Returns the counters and the leaderboards of the landing page: shop and machine counts per region, campus and metro station.'
    )
  })
    .input(z.object({}))
    .output(
      z.object({
        totals: z.object({
          shops: z.number().describe(bilingual('店铺总数。', 'Total shops.')),
          machines: z.number().describe(bilingual('机台总数。', 'Total machines.')),
          users: z.number().describe(bilingual('用户总数。', 'Total users.'))
        }),
        region: z
          .record(
            z.string(),
            z.object({
              shops: z.array(homeStatsRegionEntrySchema),
              machines: z.array(homeStatsRegionEntrySchema)
            })
          )
          .describe(bilingual('各地区层级的排行榜。', 'Leaderboards per region level.')),
        campus: homeStatsCampusSchema.describe(
          bilingual('各校区半径的排行榜。', 'Leaderboards per campus radius.')
        ),
        metro: homeStatsMetroSchema.describe(
          bilingual('各地铁站半径的排行榜。', 'Leaderboards per metro station radius.')
        )
      })
    )
};

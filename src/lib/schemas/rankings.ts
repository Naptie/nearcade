import { z } from 'zod';
import { bilingual } from './common';

/**
 * Per-radius metrics for POI-based rankings (campus, metro station). Mirrors
 * the `RankingMetrics` interface in `$lib/types` — the rankings table renders
 * this shape for every radius column. Kept as a zod schema so metro ranking
 * responses can validate their embedded rows.
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
        'Machines per 10,000 people (null when population is unavailable).'
      )
    ),
  gameSpecificMachines: z
    .array(z.object({ name: z.string(), quantity: z.number().int() }))
    .describe(bilingual('各游戏标题的机台数。', 'Machine count per game title.'))
});

export type RankingMetrics = z.infer<typeof rankingMetricsSchema>;

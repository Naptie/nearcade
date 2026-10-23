import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual, locationSchema } from '$lib/schemas/common';
import { shopApiRegionEntrySchema } from '$lib/schemas/shops';

/**
 * Stored opening hours, forwarded as they are stored.
 *
 * The globe never normalized them, so the contract describes the raw pairs
 * instead of the canonical form the shop API returns.
 */
const globeOpeningHoursSchema = z
  .array(
    z.tuple([
      z.object({
        hour: z.number().describe(bilingual('开始小时。', 'Opening hour.')),
        minute: z.number().describe(bilingual('开始分钟。', 'Opening minute.'))
      }),
      z.object({
        hour: z.number().describe(bilingual('结束小时。', 'Closing hour.')),
        minute: z.number().describe(bilingual('结束分钟。', 'Closing minute.'))
      })
    ])
  )
  .describe(bilingual('营业时间。', 'Opening hours.'));

/** One game series aggregated over the machines of a shop. */
const globeShopGameSummarySchema = z.object({
  titleId: z.number().describe(bilingual('游戏系列 ID。', 'Game title ID.')),
  name: z.string().describe(bilingual('游戏系列名称。', 'Game title name.')),
  quantity: z.number().describe(bilingual('机台数量。', 'Machine quantity.'))
});

/** A shop as the globe renders it. */
const globeShopSchema = z.object({
  id: z.number().describe(bilingual('店铺 ID。', 'Shop ID.')),
  name: z.string().describe(bilingual('店铺名称。', 'Shop name.')),
  address: z.object({
    general: z.array(z.string()).describe(bilingual('大致地址。', 'General address.')),
    region: z
      .array(shopApiRegionEntrySchema)
      .optional()
      .describe(bilingual('地区 ID 层级及本地化名。', 'Region hierarchy with localized names.'))
  }),
  openingHours: globeOpeningHoursSchema,
  location: locationSchema,
  aggregatedGames: z
    .array(globeShopGameSummarySchema)
    .describe(bilingual('按系列聚合的机台。', 'Machines aggregated per game title.')),
  currentAttendance: z.number().describe(bilingual('当前在勤人数。', 'Current attendance.')),
  density: z.number().describe(bilingual('拥挤度等级。', 'Density level.')),
  isClosed: z
    .boolean()
    .optional()
    .describe(bilingual('是否已闭店。', 'Whether the shop is closed.'))
});

/** A map pin — the lightweight projection of a shop. */
const globeMarkerSchema = z.object({
  id: z.number().describe(bilingual('店铺 ID。', 'Shop ID.')),
  name: z.string().describe(bilingual('店铺名称。', 'Shop name.')),
  lng: z.number().describe(bilingual('经度。', 'Longitude.')),
  lat: z.number().describe(bilingual('纬度。', 'Latitude.')),
  density: z.number().describe(bilingual('拥挤度等级。', 'Density level.'))
});

/** One page of the sidebar's shop list. */
const globeShopsPageSchema = z.object({
  shops: z.array(globeShopSchema).describe(bilingual('店铺列表。', 'Shops.')),
  hasMore: z.boolean().describe(bilingual('是否还有更多店铺。', 'Whether more shops exist.')),
  totalCount: z.number().describe(bilingual('店铺总数。', 'Total shop count.')),
  approximateTotal: z
    .boolean()
    .describe(bilingual('总数是否为近似值。', 'Whether the total is an approximation.'))
});

export const globeContract = {
  /** `GET /api/globe/data` — every shop with its full globe payload. */
  data: definePublic({
    method: 'GET',
    path: '/globe/data',
    operationId: 'getGlobeData',
    tags: ['globe'],
    scope: 'open',
    summary: bilingual('获取地球视图数据。', 'Get the globe data.', true),
    description: bilingual(
      '返回所有店铺的完整地球视图数据（地址、营业时间、机台与在勤人数）。',
      'Returns the full globe payload of every shop (address, opening hours, machines and attendance).'
    )
  })
    .input(z.object({}))
    .output(z.object({ shops: z.array(globeShopSchema) })),

  /** `GET /api/globe/markers` — the lightweight pins of the globe. */
  markers: definePublic({
    method: 'GET',
    path: '/globe/markers',
    operationId: 'getGlobeMarkers',
    tags: ['globe'],
    scope: 'open',
    summary: bilingual('获取地球视图标记。', 'Get the globe markers.', true),
    description: bilingual(
      '返回匹配筛选条件的店铺标记（ID、名称、坐标与拥挤度）。',
      'Returns the markers of the shops matching the filter (ID, name, coordinates and density).'
    )
  })
    .input(
      z.object({
        titles: z
          .string()
          .optional()
          .describe(bilingual('逗号分隔的游戏系列 ID。', 'Comma separated game title IDs.')),
        f: z.string().optional().describe(bilingual('编码后的筛选状态。', 'Encoded filter state.')),
        region: z
          .string()
          .optional()
          .describe(bilingual('旧版地区参数。', 'Legacy region parameter.'))
      })
    )
    .output(z.object({ shops: z.array(globeMarkerSchema) })),

  /** `GET /api/globe/shops` — the shops of the sidebar, by distance, name or ID. */
  shops: definePublic({
    method: 'GET',
    path: '/globe/shops',
    operationId: 'getGlobeShops',
    tags: ['globe'],
    scope: 'open',
    summary: bilingual('获取地球视图店铺。', 'Get the globe shops.', true),
    description: bilingual(
      '按距离、名称或店铺 ID 返回店铺列表，并附带筛选条件。',
      'Returns shops by distance, by name or by shop ID, honouring the active filter.'
    )
  })
    .input(
      z.object({
        ids: z
          .string()
          .optional()
          .describe(bilingual('逗号分隔的店铺 ID。', 'Comma separated shop IDs.')),
        titles: z
          .string()
          .optional()
          .describe(bilingual('逗号分隔的游戏系列 ID。', 'Comma separated game title IDs.')),
        f: z.string().optional().describe(bilingual('编码后的筛选状态。', 'Encoded filter state.')),
        region: z
          .string()
          .optional()
          .describe(bilingual('旧版地区参数。', 'Legacy region parameter.')),
        lat: z.coerce
          .number()
          .optional()
          .describe(bilingual('按距离排序时的纬度。', 'Latitude used by the distance query.')),
        lng: z.coerce
          .number()
          .optional()
          .describe(bilingual('按距离排序时的经度。', 'Longitude used by the distance query.')),
        offset: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .describe(bilingual('分页偏移量。', 'Pagination offset.'))
      })
    )
    .output(
      z.union([
        globeShopsPageSchema,
        z.object({ shops: z.array(globeShopSchema).describe(bilingual('店铺列表。', 'Shops.')) })
      ])
    )
};

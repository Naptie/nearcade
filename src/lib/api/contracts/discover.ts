import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual } from '$lib/schemas/common';
import { discoverQuerySchema, discoverResponseSchema } from '$lib/schemas/discover';

/**
 * The discover query.
 *
 * `discoverQuerySchema` owns every filter the endpoint understands; the two
 * additions are the `lat` / `lng` aliases the legacy handler accepted and the
 * fact that the origin itself is validated by the handler (a request without
 * an origin is answered with 400 instead of failing the contract).
 */
const discoverInputSchema = z.object({
  ...discoverQuerySchema.shape,
  latitude: discoverQuerySchema.shape.latitude.optional(),
  longitude: discoverQuerySchema.shape.longitude.optional(),
  lat: z
    .union([z.string(), z.number()])
    .optional()
    .describe(
      bilingual('原点纬度（`latitude` 的别名）。', 'Origin latitude (alias of `latitude`).')
    ),
  lng: z
    .union([z.string(), z.number()])
    .optional()
    .describe(
      bilingual('原点经度（`longitude` 的别名）。', 'Origin longitude (alias of `longitude`).')
    )
});

export const discoverContract = {
  /** `GET /api/discover` — shops around an origin point. */
  list: definePublic({
    method: 'GET',
    path: '/discover',
    operationId: 'getDiscover',
    tags: ['discover'],
    scope: 'open',
    summary: bilingual('获取附近店铺', 'Discover nearby shops', true),
    description: bilingual(
      '获取原点附近的店铺，可选择是否包含在勤人数和计算得出的营业时间信息。' +
        '`radius` 同时表示出行时间预算：每个距离档位都对应一个通常所需的出行时间，服务端据此为每家店铺计算最快的到达方式（步行 / 骑行 / 地铁），' +
        '因此地铁可达的店铺可能超出半径范围——结果始终按出行时间排序，并按 `limit` 截断。' +
        '当地铁数据可用时（原点 3 km 内有运营车站），响应还会附带 `metro` 行程块：包含最快方式为地铁的店铺的完整行程（乘车站序、官方线路色与短号），浏览器可直接渲染，无需额外请求。' +
        '注意：`limit=150` 且命中较多地铁行程时响应可达约 270 KB（gzip 后约 90 KB）。',
      'Find shops near an origin point, optionally including attendance and computed opening-time information. ' +
        '`radius` doubles as the travel-time budget: each distance option implies the time it typically takes, and the server computes each shop’s fastest option (walk / ride / metro) accordingly — so metro-reachable shops may sit beyond the radius. ' +
        'Results are always ranked by travel time and cut to `limit`. ' +
        'When metro data is available (origin within 3 km of an operating station), the response also carries a `metro` itinerary block covering the shops whose fastest option is the metro (station sequences, official line colors and short codes) — ready to render with zero follow-up requests. ' +
        'Note: with `limit=150` and many metro itineraries the response can reach ~270 KB (~90 KB gzipped).'
    )
  })
    .input(discoverInputSchema)
    .output(discoverResponseSchema)
};

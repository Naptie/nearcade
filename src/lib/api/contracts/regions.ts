import { z } from 'zod';
import { definePrivate, definePublic } from '../contract';
import { bilingual, coordinateSystemSchema } from '$lib/schemas/common';
import { regionResolutionShape } from '$lib/schemas/regions';

/** A single option in the cascading region selector. */
export const regionSelectorOptionSchema = z.object({
  id: z.string().describe(bilingual('地区 ID。', 'Region ID.')),
  label: z.string().describe(bilingual('显示名称。', 'Display label.')),
  value: z.string().describe(bilingual('提交值。', 'Submitted value.')),
  hasChildren: z
    .boolean()
    .describe(bilingual('是否还有下级地区。', 'Whether it has child regions.'))
});

export const regionHierarchyResponseSchema = z.object({
  levels: z.array(
    z.object({
      region: z.object({
        id: z.string(),
        label: z.string(),
        level: z.string(),
        hasChildren: z.boolean()
      }),
      options: z.array(regionSelectorOptionSchema)
    })
  )
});

/**
 * The point a resolution answers with, in the datum its territory stores
 * coordinates in.
 */
const resolvedLocationSchema = z.object({
  longitude: z.number().describe(bilingual('经度。', 'Longitude.')),
  latitude: z.number().describe(bilingual('纬度。', 'Latitude.')),
  coordinateSystem: coordinateSystemSchema
});

/** What the provider calls the resolved point. */
const resolvedPlaceSchema = z.object({
  address: z.string().describe(bilingual('地点地址。', 'Place address.')),
  city: z.string().optional().describe(bilingual('城市。', 'City.'))
});

/**
 * The resolved region chain.
 *
 * `chain` is absent when the chain could not be resolved; `needsManualRegion`
 * then tells the caller the user has to pick a region by hand.
 */
const resolvedRegionSchema = z.object({
  resolved: regionResolutionShape.resolved.describe(
    bilingual('是否解析出地区。', 'Whether a region was resolved.')
  ),
  chain: regionResolutionShape.chain.describe(bilingual('地区 ID 链。', 'Region ID chain.')),
  general: regionResolutionShape.general.describe(bilingual('大致地址。', 'General address.')),
  detailed: regionResolutionShape.detailed.describe(bilingual('详细地址。', 'Detailed address.')),
  needsManualRegion: regionResolutionShape.needsManualRegion.describe(
    bilingual('是否需要用户手动选择地区。', 'Whether the user has to pick a region manually.')
  ),
  matchedBy: regionResolutionShape.matchedBy.describe(
    bilingual('地区的匹配方式。', 'How the region was matched.')
  )
});

/**
 * Everything a point resolves to.
 *
 * One operation, one answer: the point, the place it is, and the region it
 * belongs to. An endpoint publishes a projection of this; it never resolves a
 * point in its own way.
 */
const resolvedPointSchema = z.object({
  location: resolvedLocationSchema,
  serviceArea: z
    .enum(['china', 'international'])
    .describe(bilingual('服务区域。', 'Service area.')),
  zone: z
    .enum(['CN_MAINLAND', 'CN_HKMO', 'CN_TW', 'INTERNATIONAL', 'UNKNOWN'])
    .optional()
    .describe(bilingual('时区分区。', 'Zone.')),
  place: resolvedPlaceSchema,
  region: resolvedRegionSchema
});

export const regionsContract = {
  /** `GET /api/regions` — children of a region for the cascading selector. */
  list: definePublic({
    method: 'GET',
    path: '/regions',
    operationId: 'getRegions',
    tags: ['regions'],
    scope: 'open',
    summary: bilingual('获取地区选项。', 'List region selector options.', true),
    description: bilingual(
      '返回指定父级地区的下级选项；省略 parentId 时返回顶级国家列表。',
      'Returns the child options of a parent region; omitting parentId returns the top-level countries.'
    )
  })
    .input(
      z
        .object({
          parentId: z.string().optional().describe(bilingual('父级地区 ID。', 'Parent region ID.')),
          locale: z.string().optional().describe(bilingual('语言代码。', 'Locale code.'))
        })
        .optional()
    )
    .output(z.array(regionSelectorOptionSchema)),

  /**
   * `GET /api/regions/resolve` — resolve a coordinate into its region.
   *
   * The one operation that resolves a point: the address the provider gives
   * it, the nearcade region chain it belongs to, and the point itself in the
   * datum its territory stores coordinates in.
   *
   * It is not published — a map provider offers reverse geocoding as a
   * documented product, so it does not belong in the published contract — and
   * third-party OAuth clients cannot reach it.
   *
   * The guard stays open because the globe's location picker uses it, and the
   * globe is the landing page: a visitor who picks a place there must be able
   * to confirm it without an account. The published contract no longer offers
   * this operation at all, so what remains is a known-path cost, not an
   * advertised one — rate limiting is the control that fits.
   */
  resolve: definePrivate({
    method: 'GET',
    path: '/regions/resolve',
    operationId: 'resolveRegion',
    tags: ['regions'],
    guard: 'none',
    summary: bilingual('将坐标解析为地区。', 'Resolve a coordinate into a region.', true),
    description: bilingual(
      '根据经纬度反向解析出地址与地区链，并返回该地点所在地区的坐标系。需要登录。',
      'Reverse-geocodes a coordinate into an address and a region chain, and returns the point in the coordinate system its territory uses. Requires a signed-in user.'
    )
  })
    .input(
      z.object({
        longitude: z.coerce.number().min(-180).max(180).describe(bilingual('经度。', 'Longitude.')),
        latitude: z.coerce.number().min(-90).max(90).describe(bilingual('纬度。', 'Latitude.')),
        coordinateSystem: coordinateSystemSchema
          .optional()
          .describe(
            bilingual(
              '坐标所在的坐标系；省略时按该地点的地图底图坐标系（WGS84 或 GCJ02）处理。',
              'The datum the incoming coordinate is expressed in; omitted, the map surface datum of that place (WGS84 or GCJ02) is assumed.'
            )
          ),
        address: z
          .string()
          .max(500)
          .optional()
          .describe(
            bilingual(
              '已知的地址提示；上游未能返回地址时作为兜底。',
              'An address hint already known; used as the fallback when the upstream returns no address.'
            )
          ),
        language: z
          .string()
          .min(2)
          .max(12)
          .optional()
          .describe(bilingual('语言代码。', 'Language code.'))
      })
    )
    .output(resolvedPointSchema),

  /** `GET /api/regions/<id1>/<id2>/…` — the whole cascade in one round trip. */
  hierarchy: definePublic({
    method: 'GET',
    path: '/regions/{+ids}',
    operationId: 'getRegionHierarchy',
    tags: ['regions'],
    scope: 'open',
    summary: bilingual('获取地区层级。', 'Get a region hierarchy.', true),
    description: bilingual(
      '按根到叶的路径返回每个地区的数据以及每一级的选项。',
      'Given a root-to-leaf path, returns each region and the selector options at every level.'
    )
  })
    .input(
      z.object({
        ids: z.string().describe(bilingual('地区 ID 路径。', 'Region ID path.')),
        locale: z.string().optional().describe(bilingual('语言代码。', 'Locale code.'))
      })
    )
    .output(regionHierarchyResponseSchema)
};

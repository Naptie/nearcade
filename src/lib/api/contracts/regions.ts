import { z } from 'zod';
import { definePublic } from '../contract';
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

export const regionResolutionResponseSchema = z.object(regionResolutionShape);

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

  /** `GET /api/regions/resolve` — reverse-geocode a coordinate into a region. */
  resolve: definePublic({
    method: 'GET',
    path: '/regions/resolve',
    operationId: 'resolveRegion',
    tags: ['regions'],
    scope: 'open',
    guard: 'session',
    summary: bilingual('将坐标解析为地区。', 'Resolve a coordinate into a region.', true),
    description: bilingual(
      '根据经纬度反向解析出地区链，需要登录。',
      'Reverse-geocodes a coordinate into a region chain. Requires a signed-in user.'
    )
  })
    .input(
      z.object({
        lat: z.coerce.number().min(-90).max(90).describe(bilingual('纬度。', 'Latitude.')),
        lng: z.coerce.number().min(-180).max(180).describe(bilingual('经度。', 'Longitude.')),
        coordinateSystem: coordinateSystemSchema
          .optional()
          .describe(bilingual('坐标系。', 'Coordinate system.')),
        address: z.string().optional().describe(bilingual('地址提示。', 'Address hint.'))
      })
    )
    .output(regionResolutionResponseSchema),

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

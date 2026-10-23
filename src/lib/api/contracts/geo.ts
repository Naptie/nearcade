import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual, coordinateSystemSchema } from '$lib/schemas/common';
import { regionResolutionShape } from '$lib/schemas/regions';

/** A point in one of the public coordinate systems. */
const coordinateSchema = z.object({
  longitude: z.number().describe(bilingual('经度。', 'Longitude.')),
  latitude: z.number().describe(bilingual('纬度。', 'Latitude.')),
  coordinateSystem: coordinateSystemSchema
});

/**
 * The region chain unified-geo resolved for a point.
 *
 * `region` is absent when the chain could not be resolved; `needsManualRegion`
 * then tells the caller the user has to pick a region by hand.
 */
const regionResolutionSchema = z.object({
  resolved: regionResolutionShape.resolved.describe(
    bilingual('是否解析出地区。', 'Whether a region was resolved.')
  ),
  region: regionResolutionShape.region.describe(bilingual('地区 ID 链。', 'Region ID chain.')),
  general: regionResolutionShape.general.describe(bilingual('大致地址。', 'General address.')),
  detailed: regionResolutionShape.detailed.describe(bilingual('详细地址。', 'Detailed address.')),
  needsManualRegion: regionResolutionShape.needsManualRegion.describe(
    bilingual('是否需要用户手动选择地区。', 'Whether the user has to pick a region manually.')
  ),
  matchedBy: regionResolutionShape.matchedBy.describe(
    bilingual('地区的匹配方式。', 'How the region was matched.')
  )
});

/** A place unified-geo's search returned. */
const placeSchema = z.object({
  id: z.string().optional().describe(bilingual('地点 ID。', 'Place ID.')),
  name: z.string().describe(bilingual('地点名称。', 'Place name.')),
  address: z.string().describe(bilingual('地点地址。', 'Place address.')),
  location: coordinateSchema,
  types: z.array(z.string()).describe(bilingual('地点类型。', 'Place types.')),
  distanceMeters: z.number().optional().describe(bilingual('距离（米）。', 'Distance in metres.'))
});

/**
 * A MapLibre style document.
 *
 * The endpoint proxies unified-geo's built-in styles verbatim, so the document
 * is whatever the provider serves — the known top-level fields are described
 * and everything else is passed through.
 */
const mapLibreStyleDocumentSchema = z.looseObject({
  version: z.number().optional().describe(bilingual('样式版本。', 'Style version.')),
  name: z.string().optional().describe(bilingual('样式名称。', 'Style name.')),
  sources: z.record(z.string(), z.unknown()).optional().describe(bilingual('数据源。', 'Sources.')),
  layers: z.array(z.unknown()).optional().describe(bilingual('图层。', 'Layers.'))
});

/** A MapLibre style document, as served by unified-geo. */
export type MapLibreStyleDocument = z.infer<typeof mapLibreStyleDocumentSchema>;

export const geoContract = {
  /** `GET /api/geo/me` — the visitor's coarse origin, derived from their IP. */
  me: definePublic({
    method: 'GET',
    path: '/geo/me',
    operationId: 'getGeoOrigin',
    tags: ['geo'],
    scope: 'open',
    summary: bilingual('获取访客的大致位置。', "Get the visitor's coarse origin.", true),
    description: bilingual(
      '根据访客 IP 解析出所在城市/省份的中心点。无法解析时返回 null；该点仅供地图初始定位使用，不代表精确位置。',
      "Resolves the centre of the visitor's city/province from their IP. Returns null when it cannot be resolved; the point only seeds the map and is never a precise fix."
    )
  })
    .input(z.object({}))
    .output(
      z.object({
        origin: z
          .object({
            lat: z.number().describe(bilingual('纬度。', 'Latitude.')),
            lng: z.number().describe(bilingual('经度。', 'Longitude.')),
            level: z
              .enum(['country', 'province', 'city', 'county', 'street'])
              .describe(bilingual('地区层级。', 'Region hierarchy level.')),
            source: z.literal('ip-region').describe(bilingual('来源。', 'Source.'))
          })
          .nullable()
      })
    ),

  /** `GET /api/geo/translate` — convert a point into the map surface's datum. */
  translate: definePublic({
    method: 'GET',
    path: '/geo/translate',
    operationId: 'translateGeoCoordinate',
    tags: ['geo'],
    scope: 'open',
    summary: bilingual('转换坐标。', 'Translate a coordinate.', true),
    description: bilingual(
      '将一个坐标转换为地图底图所选地区的坐标系（WGS84 或 GCJ02）。无法转换时原样返回。',
      'Converts a coordinate into the coordinate system chosen for its territory (WGS84 or GCJ02). The point is returned unchanged when it cannot be converted.'
    )
  })
    .input(
      z.object({
        lat: z.coerce
          .number()
          .min(-90)
          .max(90)
          .optional()
          .describe(bilingual('纬度。', 'Latitude.')),
        lng: z.coerce
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe(bilingual('经度。', 'Longitude.')),
        from: z
          .enum(['gps', 'WGS84', 'GCJ02'])
          .optional()
          .describe(
            bilingual(
              '原坐标系；gps 等同于 WGS84。',
              'Source coordinate system; gps is an alias of WGS84.'
            )
          )
      })
    )
    .output(
      z.object({
        converted: z
          .boolean()
          .describe(bilingual('坐标是否被转换。', 'Whether the coordinate was converted.')),
        lng: z.number().describe(bilingual('经度。', 'Longitude.')),
        lat: z.number().describe(bilingual('纬度。', 'Latitude.')),
        coordinateSystem: coordinateSystemSchema
      })
    ),

  /** `GET /api/geo/style` — proxy unified-geo's MapLibre style documents. */
  style: definePublic({
    method: 'GET',
    path: '/geo/style',
    operationId: 'getGeoMapStyle',
    tags: ['geo'],
    scope: 'open',
    // The style document is served as-is — not wrapped in an envelope — so the
    // response needs the detailed output structure.
    outputStructure: 'detailed',
    summary: bilingual('获取地图样式。', 'Get a map style.', true),
    description: bilingual(
      '代理 unified-geo 内置的 MapLibre 样式文档。响应体是原始的样式 JSON（不包裹在信封中），并透传上游的 Cache-Control。',
      "Proxies unified-geo's built-in MapLibre style documents. The response body is the raw style JSON (not wrapped in an envelope) and the upstream Cache-Control is passed through."
    )
  })
    .input(
      z.object({
        provider: z
          .enum(['bing-cn', 'amap', 'google'])
          .describe(bilingual('底图服务商。', 'Basemap provider.')),
        theme: z.enum(['dark', 'light']).optional().describe(bilingual('主题。', 'Theme.')),
        locale: z
          .string()
          .transform((value) =>
            value
              .split(',')
              .map((tag) => tag.trim())
              .find((tag) => tag === 'zh-CN' || tag === 'en-US')
          )
          .optional()
          .describe(
            bilingual(
              '语言标签（可多选，取第一个受支持的值）。',
              'Locale tag (comma separated; the first supported tag wins).'
            )
          )
      })
    )
    .output(
      z.object({
        status: z.literal(200),
        headers: z.object({
          'content-type': z.literal('application/json'),
          'cache-control': z.string().optional()
        }),
        body: z.union([mapLibreStyleDocumentSchema, z.string()])
      })
    ),

  /** `POST /api/geo/picker/search` — search places around a map centre. */
  pickerSearch: definePublic({
    method: 'POST',
    path: '/geo/picker/search',
    operationId: 'searchGeoPlaces',
    tags: ['geo'],
    scope: 'open',
    summary: bilingual('搜索地点。', 'Search places.', true),
    description: bilingual(
      '在给定中心点附近搜索地点，结果使用地图底图所选地区的坐标系。',
      'Searches for places around a centre point; the results use the coordinate system chosen for the map surface.'
    )
  })
    .input(
      z.object({
        query: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .describe(bilingual('搜索关键词。', 'Search query.')),
        longitude: z
          .number()
          .min(-180)
          .max(180)
          .describe(bilingual('中心点经度。', 'Centre longitude.')),
        latitude: z
          .number()
          .min(-90)
          .max(90)
          .describe(bilingual('中心点纬度。', 'Centre latitude.')),
        language: z.string().min(2).max(12).describe(bilingual('语言代码。', 'Language code.'))
      })
    )
    .output(
      z.object({
        places: z.array(placeSchema).describe(bilingual('地点列表。', 'Matching places.')),
        coordinateSystem: coordinateSystemSchema
      })
    ),

  /** `POST /api/geo/picker/confirm` — confirm a picked point and resolve its region. */
  pickerConfirm: definePublic({
    method: 'POST',
    path: '/geo/picker/confirm',
    operationId: 'confirmGeoLocation',
    tags: ['geo'],
    scope: 'open',
    summary: bilingual('确认选中的位置。', 'Confirm a picked location.', true),
    description: bilingual(
      '将选中的坐标反向解析为地址与地区链，并按需转换到 GCJ02。',
      'Reverse-geocodes the picked coordinate into an address and a region chain, converting it to GCJ02 where the territory requires it.'
    )
  })
    .input(
      z.object({
        longitude: z.number().min(-180).max(180).describe(bilingual('经度。', 'Longitude.')),
        latitude: z.number().min(-90).max(90).describe(bilingual('纬度。', 'Latitude.')),
        language: z.string().min(2).max(12).describe(bilingual('语言代码。', 'Language code.')),
        name: z
          .string()
          .max(300)
          .optional()
          .describe(bilingual('用户填写的名称。', 'Name entered by the user.')),
        address: z
          .string()
          .max(1000)
          .optional()
          .describe(bilingual('用户填写的地址。', 'Address entered by the user.')),
        coordinateSystem: coordinateSystemSchema
          .optional()
          .describe(
            bilingual(
              '坐标的原始坐标系；省略时由服务端按地图区域推断。',
              'The datum of the incoming point; omitted, the server resolves the datum the map surface implies.'
            )
          )
      })
    )
    .output(
      z.object({
        location: coordinateSchema,
        serviceArea: z
          .enum(['china', 'international'])
          .describe(bilingual('服务区域。', 'Service area.')),
        zone: z
          .enum(['CN_MAINLAND', 'CN_HKMO', 'CN_TW', 'INTERNATIONAL', 'UNKNOWN'])
          .optional()
          .describe(bilingual('时区分区。', 'Zone.')),
        provider: z.string().describe(bilingual('上游服务商。', 'Upstream provider.')),
        name: z.string().describe(bilingual('地点名称。', 'Place name.')),
        address: z.string().describe(bilingual('地点地址。', 'Place address.')),
        city: z.string().optional().describe(bilingual('城市。', 'City.')),
        ...regionResolutionSchema.shape
      })
    )
};

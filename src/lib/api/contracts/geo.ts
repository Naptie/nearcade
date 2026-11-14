import { z } from 'zod';
import { definePrivate } from '../contract';
import { bilingual, coordinateSystemSchema } from '$lib/schemas/common';

/** A point in one of the public coordinate systems. */
const coordinateSchema = z.object({
  longitude: z.number().describe(bilingual('经度。', 'Longitude.')),
  latitude: z.number().describe(bilingual('纬度。', 'Latitude.')),
  coordinateSystem: coordinateSystemSchema
});

/**
 * One candidate route.
 *
 * The routing service owns this shape, so every object in it stays loose: a
 * strict object would drop the fields this app does not read but a provider
 * adds, and the drawn route is the geometry plus the legs.
 */
export const routeResultSchema = z.looseObject({
  mode: z.enum(['driving', 'walking', 'cycling', 'transit']),
  distanceMeters: z.number(),
  durationSeconds: z.number(),
  geometry: z.array(z.tuple([z.number(), z.number()])),
  legs: z.array(
    z.looseObject({
      kind: z.enum(['walk', 'ride', 'drive', 'bus', 'subway', 'rail', 'ferry']),
      name: z.string().optional(),
      color: z.string().nullable().optional(),
      distanceMeters: z.number(),
      durationSeconds: z.number(),
      steps: z.array(
        z.looseObject({
          instruction: z.string().optional(),
          distanceMeters: z.number().optional(),
          durationSeconds: z.number().optional()
        })
      ),
      stations: z
        .looseObject({
          on: z.string().optional(),
          off: z.string().optional(),
          via: z.array(z.string()).optional(),
          stopCount: z.number().optional()
        })
        .optional()
    })
  ),
  coordinateSystem: z.enum(['WGS84', 'GCJ02']),
  lines: z
    .array(z.looseObject({ name: z.string(), color: z.string().nullable().optional() }))
    .optional(),
  cost: z.number().optional()
});

/** One candidate route, as the contract describes it. */
export type RouteResultPayload = z.infer<typeof routeResultSchema>;

/** A place the provider's search returned. */
const placeSchema = z.object({
  id: z.string().optional().describe(bilingual('地点 ID。', 'Place ID.')),
  name: z.string().describe(bilingual('地点名称。', 'Place name.')),
  address: z.string().describe(bilingual('地点地址。', 'Place address.')),
  location: coordinateSchema,
  types: z.array(z.string()).describe(bilingual('地点类型。', 'Place types.')),
  distanceMeters: z.number().optional().describe(bilingual('距离（米）。', 'Distance in metres.'))
});

/**
 * The geo surface: the map's own plumbing.
 *
 * Every procedure here does what a map provider does — resolve a place,
 * translate a coordinate, search for a point of interest. None of it is
 * nearcade's own product, and a commercial map provider offers the same
 * capabilities as a documented product, so none of it belongs in the published
 * contract.
 *
 * The procedures are served — the first-party client uses them — but they are
 * not published, and third-party OAuth clients cannot reach them.
 */
export const geoContract = {
  /** `GET /api/geo/me` — the visitor's coarse origin, derived from their IP. */
  me: definePrivate({
    method: 'GET',
    path: '/geo/me',
    operationId: 'getGeoOrigin',
    tags: ['geo'],
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
  translate: definePrivate({
    method: 'GET',
    path: '/geo/translate',
    operationId: 'translateGeoCoordinate',
    tags: ['geo'],
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

  /** `POST /api/geo/picker/search` — search places around a map centre. */
  pickerSearch: definePrivate({
    method: 'POST',
    path: '/geo/picker/search',
    operationId: 'searchGeoPlaces',
    tags: ['geo'],
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

  /** `POST /api/geo/geocode` — resolve an address or place name into coordinates. */
  geocode: definePrivate({
    method: 'POST',
    path: '/geo/geocode',
    operationId: 'geocodeAddress',
    tags: ['geo'],
    summary: bilingual('地址解析。', 'Geocode an address.', true),
    description: bilingual(
      '将 `name`（地点名）或 `address` 解析为坐标，结果使用地图底图所选地区的坐标系；' +
        '偏置点缺省时从 `address` 的行政区划前缀推导。',
      'Resolves `name` (a place name) or `address` into coordinates; the results use the ' +
        'coordinate system chosen for the map surface. The bias point is derived from the ' +
        'administrative prefix of `address` when `near` is absent.'
    )
  })
    .input(
      z.object({
        address: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe(bilingual('地址文本。', 'Address text.')),
        name: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .describe(bilingual('地点名。', 'Place name.')),
        near: coordinateSchema.optional().describe(bilingual('偏置点。', 'Bias point.')),
        radius: z
          .number()
          .int()
          .min(1)
          .max(50_000)
          .optional()
          .describe(bilingual('偏置半径（米）。', 'Bias radius in metres.'))
      })
    )
    .output(
      z.object({
        provider: z.string().describe(bilingual('结果来源。', 'Provider.')),
        routingPolicy: z.string().nullable().describe(bilingual('路由策略。', 'Routing policy.')),
        coordinateSystem: coordinateSystemSchema,
        results: z
          .array(
            z.object({
              formattedAddress: z
                .string()
                .describe(bilingual('格式化地址。', 'Formatted address.')),
              location: coordinateSchema,
              accuracy: z.string().optional().describe(bilingual('精度。', 'Accuracy.')),
              placeId: z.string().optional().describe(bilingual('地点 ID。', 'Place ID.'))
            })
          )
          .describe(bilingual('解析结果。', 'Resolved results.'))
      })
    ),

  /** `GET /api/geo/map-style` — the render-ready profile and style for a point. */
  mapStyle: definePrivate({
    method: 'GET',
    path: '/geo/map-style',
    operationId: 'getMapStyle',
    tags: ['geo'],
    summary: bilingual('获取地图样式。', 'Get a map style.', true),
    description: bilingual(
      '返回某个点的地图配置（profile）与其对应的 MapLibre 样式文档。底图归属由服务端解析，' +
        '浏览器的地图适配器负责渲染并按视口刷新版权行；服务端密钥不出现在文档中——' +
        '浏览器直连瓦片端点所需的公开 key 与会话标识按设计随文档下发。',
      'Returns the map profile for a point together with its MapLibre style document. The basemap ' +
        'attribution is resolved server-side; the browser adapter renders it and refreshes the ' +
        'copyright line per viewport. Server secrets never appear in the document — the public ' +
        'keys and session tokens the browser needs for direct tile fetching ride along by design.'
    )
  })
    .input(
      z.object({
        longitude: z.coerce.number().min(-180).max(180).describe(bilingual('经度。', 'Longitude.')),
        latitude: z.coerce.number().min(-90).max(90).describe(bilingual('纬度。', 'Latitude.')),
        theme: z.enum(['dark', 'light']).optional().describe(bilingual('主题。', 'Theme.')),
        // Some callers pass multi-market locale values (zh-CN,en-US); take the first
        // recognized tag instead of rejecting the request.
        locale: z
          .string()
          .transform((value) =>
            value
              .split(',')
              .map((tag) => tag.trim())
              .find((tag) => tag === 'zh-CN' || tag === 'en-US' || tag.startsWith('zh'))
          )
          .optional()
          .describe(bilingual('区域设置。', 'Locale.')),
        scope: z.enum(['regional', 'global']).optional().describe(bilingual('范围。', 'Scope.'))
      })
    )
    .output(
      // Both bodies are passed through as the upstream served them: a profile
      // carries fields this app does not read, and the style document is the
      // provider's own — a strict object would strip the style to nothing.
      z.object({
        profile: z.looseObject({}).describe(bilingual('地图配置。', 'Map profile.')),
        style: z.looseObject({}).describe(bilingual('样式文档。', 'Style document.'))
      })
    ),

  /** `GET /api/geo/attribution` — the map data attribution for a viewport. */
  attribution: definePrivate({
    method: 'GET',
    path: '/geo/attribution',
    operationId: 'getGeoAttribution',
    tags: ['geo'],
    summary: bilingual('获取视口版权信息。', 'Get the attribution for a viewport.', true),
    description: bilingual(
      '返回给定视口的数据版权文本。浏览器的地图适配器在相机移入新视口时调用它，' +
        '以保持版权声明与当前显示的数据一致。',
      'Returns the data copyright text for a viewport. The browser map adapter calls it as the camera enters a new viewport, so the copyright line always matches the data on screen.'
    )
  })
    .input(
      z.object({
        zoom: z.coerce.number().min(0).max(30).describe(bilingual('缩放级别。', 'Zoom level.')),
        north: z.coerce.number().min(-85).max(85).describe(bilingual('北纬。', 'North latitude.')),
        south: z.coerce.number().min(-85).max(85).describe(bilingual('南纬。', 'South latitude.')),
        east: z.coerce.number().min(-180).max(180).describe(bilingual('东经。', 'East longitude.')),
        west: z.coerce.number().min(-180).max(180).describe(bilingual('西经。', 'West longitude.'))
      })
    )
    .output(
      z.object({ copyright: z.string().describe(bilingual('版权文本。', 'Copyright text.')) })
    ),

  /** `GET /api/geo/links` — the per-platform links for a point. */
  links: definePrivate({
    method: 'GET',
    path: '/geo/links',
    operationId: 'getGeoLinks',
    tags: ['geo'],
    summary: bilingual('获取地图链接。', 'Get the map links.', true),
    description: bilingual(
      '返回某个点的跨平台地图链接（geo: 通用链接、Android 选择器、iOS 深链，以及按地区选择的网页版）。' +
        '调用方按设备选择其一，不需要了解任何服务商。',
      'Returns the cross-platform map links for a point: a universal geo: link, an Android chooser, an iOS deep link and a web link routed by the region. The caller picks one per device and needs no provider knowledge.'
    )
  })
    .input(
      z.object({
        longitude: z.coerce.number().min(-180).max(180).describe(bilingual('经度。', 'Longitude.')),
        latitude: z.coerce.number().min(-90).max(90).describe(bilingual('纬度。', 'Latitude.')),
        name: z.string().max(80).optional().describe(bilingual('地点名。', 'Place name.')),
        mode: z
          .enum(['view', 'navigation'])
          .optional()
          .describe(bilingual('链接用途。', 'Link mode.')),
        travelMode: z
          .enum(['driving', 'walking', 'cycling', 'transit'])
          .optional()
          .describe(bilingual('出行方式。', 'Travel mode.')),
        coordinateSystem: z
          .enum(['WGS84', 'GCJ02'])
          .optional()
          .describe(bilingual('坐标系。', 'Coordinate system.'))
      })
    )
    .output(
      z.object({
        success: z.literal(true),
        universal: z.string().describe(bilingual('通用链接。', 'Universal link.')),
        android: z.string().optional().describe(bilingual('Android 链接。', 'Android link.')),
        ios: z.string().optional().describe(bilingual('iOS 链接。', 'iOS link.')),
        web: z.string().optional().describe(bilingual('网页版链接。', 'Web link.'))
      })
    ),

  /** `GET /api/geo/capabilities` — which features each zone offers. */
  capabilities: definePrivate({
    method: 'GET',
    path: '/geo/capabilities',
    operationId: 'getGeoCapabilities',
    tags: ['geo'],
    summary: bilingual('获取地理能力。', 'Get the geo capabilities.', true),
    description: bilingual(
      '返回各区域可用的功能矩阵（解析、逆地理编码、地理编码、地点搜索与四种出行方式），' +
        '以便界面在不感知底图来源的情况下隐藏不可用的功能。',
      'Returns the per-zone feature matrix — resolution, reverse geocoding, geocoding, place search and the four travel modes — so the interface can hide what the current basemap cannot do.'
    )
  })
    .input(z.object({}))
    .output(
      // The matrix carries a zone list and a provider block this app does not
      // read, so the object stays loose.
      z.looseObject({ success: z.literal(true) })
    ),

  /** `POST /api/geo/directions` — the routes between two points. */
  directions: definePrivate({
    method: 'POST',
    path: '/geo/directions',
    operationId: 'getGeoDirections',
    tags: ['geo'],
    summary: bilingual('获取路线。', 'Get the directions.', true),
    description: bilingual(
      '返回两点之间的路线。几何坐标与底图使用同一坐标系，因此可以直接绘制在当前底图上。',
      'Returns the routes between two points. The geometry carries the basemap’s own datum, so it can be drawn on it directly.'
    )
  })
    .input(
      z.object({
        origin: coordinateSchema.describe(bilingual('起点。', 'Origin.')),
        destination: coordinateSchema.describe(bilingual('终点。', 'Destination.')),
        mode: z
          .enum(['driving', 'walking', 'cycling', 'transit'])
          .describe(bilingual('出行方式。', 'Travel mode.')),
        language: z
          .string()
          .min(2)
          .max(12)
          .optional()
          .describe(bilingual('语言代码。', 'Language code.'))
      })
    )
    .output(
      z.object({
        success: z.literal(true),
        routes: z.array(routeResultSchema)
      })
    )
};

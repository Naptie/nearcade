import { defineOpenApiRoute, jsonResponse } from '$lib/openapi/route';
import { discoverResponseOpenApiSchema } from '$lib/openapi/components';
import { multilingual } from '$lib/schemas/common';
import { discoverQuerySchema } from '$lib/schemas/discover';

export default defineOpenApiRoute({
  get: {
    tags: ['discover'],
    summary: 'Discover nearby shops / 获取附近店铺',
    description: multilingual(
      'Find shops near an origin point, optionally including attendance and computed opening-time information.',
      '获取原点附近的店铺，可选择是否包含在勤人数和计算得出的营业时间信息。'
    ),
    requestParams: {
      query: discoverQuerySchema
    },
    responses: {
      '200': jsonResponse('Nearby shops / 附近店铺', discoverResponseOpenApiSchema),
      '400': { description: 'Bad Request / 请求错误' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  }
});

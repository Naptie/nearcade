import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/openapi/route';
import { shopResponseOpenApiSchema, updateShopRequestSchema } from '$lib/openapi/components';
import { bilingual } from '$lib/schemas/common';
import { shopDetailQuerySchema, shopIdParamSchema } from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取店铺详情', 'Get shop details', true),
    description: bilingual(
      '按数字 ID 获取店铺详情。当前 API 路由为 `/shops/{id}`；旧版手写文档使用 `/shops/{source}/{id}`。',
      'Get details for a shop by numeric ID. The current API route is `/shops/{id}`; legacy handwritten docs used `/shops/{source}/{id}`.'
    ),
    requestParams: {
      path: shopIdParamSchema,
      query: shopDetailQuerySchema
    },
    responses: {
      '200': jsonResponse(bilingual('店铺详情', 'Shop details', true), shopResponseOpenApiSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('店铺不存在', 'Shop not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  put: {
    tags: ['shops'],
    summary: bilingual('更新店铺', 'Update shop', true),
    description: bilingual('按数字 ID 更新店铺字段。', 'Update shop fields by numeric ID.'),
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(updateShopRequestSchema),
    responses: {
      '200': jsonResponse(bilingual('已更新店铺', 'Updated shop', true), shopResponseOpenApiSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('店铺不存在', 'Shop not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

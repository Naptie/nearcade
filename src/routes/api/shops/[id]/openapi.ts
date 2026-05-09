import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/openapi/route';
import { shopResponseOpenApiSchema, updateShopRequestSchema } from '$lib/openapi/components';
import { multilingual } from '$lib/schemas/common';
import { shopDetailQuerySchema, shopIdParamSchema } from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: 'Get shop details / 获取店铺详情',
    description: multilingual(
      'Get details for a shop by numeric ID. The current API route is `/shops/{id}`; legacy handwritten docs used `/shops/{source}/{id}`.',
      '按数字 ID 获取店铺详情。当前 API 路由为 `/shops/{id}`；旧版手写文档使用 `/shops/{source}/{id}`。'
    ),
    requestParams: {
      path: shopIdParamSchema,
      query: shopDetailQuerySchema
    },
    responses: {
      '200': jsonResponse('Shop details / 店铺详情', shopResponseOpenApiSchema),
      '400': { description: 'Bad Request / 请求错误' },
      '404': { description: 'Shop not found / 店铺不存在' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  },
  put: {
    tags: ['shops'],
    summary: 'Update shop / 更新店铺',
    description: multilingual('Update shop fields by numeric ID.', '按数字 ID 更新店铺字段。'),
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(updateShopRequestSchema),
    responses: {
      '200': jsonResponse('Updated shop / 已更新店铺', shopResponseOpenApiSchema),
      '400': { description: 'Bad Request / 请求错误' },
      '404': { description: 'Shop not found / 店铺不存在' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  }
});

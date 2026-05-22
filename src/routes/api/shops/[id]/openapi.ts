import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  adminUpdateShopRequestSchema,
  shopResponseSchema,
  updateShopRequestSchema,
  shopDetailQuerySchema,
  shopIdParamSchema
} from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取店铺详情', 'Get shop details', true),
    description: bilingual('按 ID 获取店铺详情。', 'Get details for a shop by ID.'),
    requestParams: {
      path: shopIdParamSchema,
      query: shopDetailQuerySchema
    },
    responses: {
      '200': jsonResponse(bilingual('店铺详情', 'Shop details', true), shopResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('店铺不存在', 'Shop not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  put: {
    tags: ['shops'],
    summary: bilingual('更新店铺', 'Update shop', true),
    description: bilingual('按 ID 更新店铺字段。', 'Update shop fields by ID.'),
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(updateShopRequestSchema),
    responses: {
      '200': jsonResponse(bilingual('已更新店铺', 'Updated shop', true), shopResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '403': { description: bilingual('无权操作', 'Forbidden', true) },
      '404': { description: bilingual('店铺不存在', 'Shop not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  patch: {
    tags: ['shops'],
    summary: bilingual('管理员更新店铺', 'Admin update shop', true),
    description: bilingual(
      '管理员按 ID 更新店铺的管理字段（如锁定状态）。',
      'Admin-only endpoint to update administrative shop fields (e.g. locked status) by ID.'
    ),
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(adminUpdateShopRequestSchema),
    responses: {
      '200': jsonResponse(bilingual('已更新店铺', 'Updated shop', true), shopResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '403': { description: bilingual('无权操作', 'Forbidden', true) },
      '404': { description: bilingual('店铺不存在', 'Shop not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

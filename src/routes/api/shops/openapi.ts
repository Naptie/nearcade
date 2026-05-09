import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/openapi/route';
import {
  createShopRequestSchema,
  shopResponseOpenApiSchema,
  shopsListResponseOpenApiSchema
} from '$lib/openapi/components';
import { bilingual } from '$lib/schemas/common';
import { shopsListQuerySchema } from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取店铺列表', 'List shops', true),
    description: bilingual('获取分页店铺列表。支持查询字符串，并可选择是否包含计算得出的时区与营业状态。', 'Get a paginated list of shops. Supports text search and optional computed time information.'),
    requestParams: {
      query: shopsListQuerySchema
    },
    responses: {
      '200': jsonResponse(bilingual('店铺列表', 'Shops list', true), shopsListResponseOpenApiSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  post: {
    tags: ['shops'],
    summary: bilingual('创建店铺', 'Create shop', true),
    description: bilingual('创建新店铺。', 'Create a new shop.'),
    requestBody: jsonRequestBody(createShopRequestSchema),
    responses: {
      '201': jsonResponse(bilingual('已创建店铺', 'Created shop', true), shopResponseOpenApiSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/openapi/route';
import {
  createShopRequestSchema,
  shopResponseOpenApiSchema,
  shopsListResponseOpenApiSchema
} from '$lib/openapi/components';
import { multilingual } from '$lib/schemas/common';
import { shopsListQuerySchema } from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: 'List shops / 获取店铺列表',
    description: multilingual(
      'Get a paginated list of shops. Supports text search and optional computed time information.',
      '获取分页店铺列表。支持查询字符串，并可选择是否包含计算得出的时区与营业状态。'
    ),
    requestParams: {
      query: shopsListQuerySchema
    },
    responses: {
      '200': jsonResponse('Shops list / 店铺列表', shopsListResponseOpenApiSchema),
      '400': { description: 'Bad Request / 请求错误' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  },
  post: {
    tags: ['shops'],
    summary: 'Create shop / 创建店铺',
    description: multilingual('Create a new shop.', '创建新店铺。'),
    requestBody: jsonRequestBody(createShopRequestSchema),
    responses: {
      '201': jsonResponse('Created shop / 已创建店铺', shopResponseOpenApiSchema),
      '400': { description: 'Bad Request / 请求错误' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  }
});

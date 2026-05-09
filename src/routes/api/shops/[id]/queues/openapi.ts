import { bearerAuth, defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/openapi/route';
import {
  queueListResponseOpenApiSchema,
  queueReportRequestSchema,
  queueReportResponseOpenApiSchema
} from '$lib/openapi/components';
import { multilingual } from '$lib/schemas/common';
import { shopIdParamSchema } from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: 'Get machine queues / 获取机台队列',
    description: multilingual('Get current queue data for a shop.', '获取店铺当前机台队列数据。'),
    requestParams: {
      path: shopIdParamSchema
    },
    responses: {
      '200': jsonResponse('Queue data / 队列数据', queueListResponseOpenApiSchema),
      '400': { description: 'Bad Request / 请求错误' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  },
  post: {
    tags: ['shops'],
    summary: 'Report machine queues / 上报机台队列',
    description: multilingual(
      'Report machine queue states for one or more games in a shop.',
      '上报店铺中一个或多个游戏的机台队列状态。'
    ),
    security: bearerAuth,
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(queueReportRequestSchema),
    responses: {
      '200': jsonResponse('Queue report accepted / 队列上报成功', queueReportResponseOpenApiSchema),
      '400': { description: 'Bad Request / 请求错误' },
      '401': { description: 'Invalid machine credentials / 机台凭据无效' },
      '403': { description: 'Machine not bound to this shop / 机台未绑定到该店铺' },
      '404': { description: 'Shop or game not found / 店铺或游戏不存在' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  }
});

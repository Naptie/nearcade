import { bearerAuth, defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/openapi/route';
import {
  queueListResponseOpenApiSchema,
  queueReportRequestSchema,
  queueReportResponseOpenApiSchema
} from '$lib/openapi/components';
import { bilingual } from '$lib/schemas/common';
import { shopIdParamSchema } from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取机台队列', 'Get machine queues', true),
    description: bilingual('获取店铺当前机台队列数据。', 'Get current queue data for a shop.'),
    requestParams: {
      path: shopIdParamSchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('队列数据', 'Queue data', true),
        queueListResponseOpenApiSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  post: {
    tags: ['shops'],
    summary: bilingual('上报机台队列', 'Report machine queues', true),
    description: bilingual(
      '上报店铺中一个或多个游戏的机台队列状态。',
      'Report machine queue states for one or more games in a shop.'
    ),
    security: bearerAuth,
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(queueReportRequestSchema),
    responses: {
      '200': jsonResponse(
        bilingual('队列上报成功', 'Queue report accepted', true),
        queueReportResponseOpenApiSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('机台凭据无效', 'Invalid machine credentials', true) },
      '403': {
        description: bilingual('机台未绑定到该店铺', 'Machine not bound to this shop', true)
      },
      '404': { description: bilingual('店铺或游戏不存在', 'Shop or game not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

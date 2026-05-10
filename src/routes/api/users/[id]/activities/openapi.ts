import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  userActivitiesQuerySchema,
  userActivitiesResponseSchema,
  userRouteIdParamSchema
} from '$lib/schemas/users';

export default defineOpenApiRoute({
  get: {
    tags: ['users'],
    summary: bilingual('获取用户活动', 'Get user activities', true),
    description: bilingual(
      '获取用户活动流，并根据隐私设置和当前查看者权限过滤不可见内容。',
      'Get a user activity feed, with entries filtered according to privacy settings and the current viewer permissions.'
    ),
    requestParams: {
      path: userRouteIdParamSchema,
      query: userActivitiesQuerySchema
    },
    responses: {
      '200': jsonResponse(bilingual('用户活动', 'User activities', true), userActivitiesResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '403': { description: bilingual('活动不可见', 'Activities are private', true) },
      '404': { description: bilingual('用户不存在', 'User not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

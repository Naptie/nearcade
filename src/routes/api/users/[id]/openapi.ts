import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { userProfileResponseSchema, userRouteIdParamSchema } from '$lib/schemas/users';

export default defineOpenApiRoute({
  get: {
    tags: ['users'],
    summary: bilingual('获取用户资料', 'Get a user profile', true),
    description: bilingual(
      '获取用户公开资料；当当前用户有权限时，也会包含受隐私控制的邮箱、学校和机厅信息。',
      'Get a user profile. When the current viewer has permission, the response also includes privacy-controlled email, university, and arcade information.'
    ),
    requestParams: {
      path: userRouteIdParamSchema
    },
    responses: {
      '200': jsonResponse(bilingual('用户资料', 'User profile', true), userProfileResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('用户不存在', 'User not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

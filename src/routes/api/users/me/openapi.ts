import { defineOpenApiRoute, jsonResponse, sessionOrOAuth2 } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { userProfileResponseSchema } from '$lib/schemas/users';

export default defineOpenApiRoute({
  get: {
    tags: ['users'],
    summary: bilingual('获取当前用户资料', 'Get the current user profile', true),
    description: bilingual(
      '获取当前已登录用户的完整资料。',
      'Get the full profile of the currently authenticated user.'
    ),
    security: sessionOrOAuth2('profile'),
    responses: {
      '200': jsonResponse(
        bilingual('当前用户资料', 'Current user profile', true),
        userProfileResponseSchema
      ),
      '401': { description: bilingual('未登录', 'Unauthorized', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

import {
  defineOpenApiRoute,
  jsonRequestBody,
  jsonResponse,
  sessionOrOAuth2,
  successJsonResponse
} from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { ugcPreferencesResponseSchema, ugcPreferencesUpdateRequestSchema } from '$lib/schemas/ugc';

export default defineOpenApiRoute({
  get: {
    tags: ['ugc'],
    summary: bilingual('查询 AI 自动翻译偏好', 'Get AI auto-translation preferences', true),
    description: bilingual(
      '返回当前用户开启 AI 翻译的内容类型与首次使用提示状态。未登录时返回 loggedIn=false 且不翻译任何内容。',
      "Returns the caller's opted-in translation content types and first-use prompt state. For anonymous callers, loggedIn=false and nothing is translated."
    ),
    security: sessionOrOAuth2('read:users'),
    responses: {
      '200': jsonResponse(
        bilingual('翻译偏好', 'Translation preferences', true),
        ugcPreferencesResponseSchema
      ),
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  post: {
    tags: ['ugc'],
    summary: bilingual('更新 AI 自动翻译偏好', 'Update AI auto-translation preferences', true),
    description: bilingual(
      '部分更新当前用户的 AI 自动翻译偏好：可勾选的内容类型，或永久关闭首次使用提示。需要登录。',
      "Partially updates the caller's AI auto-translation preferences: opted-in content types, or permanently dismissing the first-use prompt. Requires sign-in."
    ),
    security: sessionOrOAuth2('write:users'),
    requestBody: jsonRequestBody(ugcPreferencesUpdateRequestSchema),
    responses: {
      '200': successJsonResponse(),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '404': { description: bilingual('用户不存在', 'User not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

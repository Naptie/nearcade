import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { activateMachineResponseSchema, activateMachineQuerySchema } from '$lib/schemas/machines';

export default defineOpenApiRoute({
  post: {
    tags: ['machines'],
    summary: bilingual('激活机台', 'Activate machine', true),
    description: bilingual(
      '通过机台序列号激活机台，并返回 API 密钥。',
      'Activate a machine by serial number and return its API secret.'
    ),
    requestParams: {
      query: activateMachineQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('机台已激活', 'Machine activated', true),
        activateMachineResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('机台不存在', 'Machine not found', true) }
    }
  }
});

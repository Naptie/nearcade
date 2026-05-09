import { defineOpenApiRoute, jsonResponse } from '$lib/openapi/route';
import { machineActivationResponseOpenApiSchema } from '$lib/openapi/components';
import { multilingual } from '$lib/schemas/common';
import { activateMachineQuerySchema } from '$lib/schemas/machines';

export default defineOpenApiRoute({
  post: {
    tags: ['machines'],
    summary: 'Activate machine / 激活机台',
    description: multilingual(
      'Activate a machine by serial number and return its API secret.',
      '通过机台序列号激活机台，并返回 API 密钥。'
    ),
    requestParams: {
      query: activateMachineQuerySchema
    },
    responses: {
      '200': jsonResponse('Machine activated / 机台已激活', machineActivationResponseOpenApiSchema),
      '400': { description: 'Bad Request / 请求错误' },
      '404': { description: 'Machine not found / 机台不存在' }
    }
  }
});

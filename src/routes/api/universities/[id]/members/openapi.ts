import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import {
  universityIdParamSchema,
  universityMembersQuerySchema,
  universityMembersResponseSchema
} from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  get: {
    tags: ['universities'],
    summary: bilingual('获取大学成员', 'Get university members', true),
    description: bilingual(
      '分页获取大学成员列表。未公开大学信息的用户会根据查看者权限被过滤。',
      'Get a paginated list of university members. Users with private university visibility are filtered based on viewer permissions.'
    ),
    requestParams: {
      path: universityIdParamSchema,
      query: universityMembersQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('大学成员列表', 'University member list', true),
        universityMembersResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('大学不存在', 'University not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

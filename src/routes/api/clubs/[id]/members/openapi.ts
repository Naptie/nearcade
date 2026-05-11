import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import {
  clubIdParamSchema,
  clubMembersQuerySchema,
  clubMembersResponseSchema
} from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  get: {
    tags: ['clubs'],
    summary: bilingual('获取社团成员', 'Get club members', true),
    description: bilingual(
      '分页获取社团成员列表。未公开大学信息的用户会根据查看者权限被过滤。',
      'Get a paginated list of club members. Users with private university visibility are filtered based on viewer permissions.'
    ),
    requestParams: {
      path: clubIdParamSchema,
      query: clubMembersQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('社团成员列表', 'Club member list', true),
        clubMembersResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('社团不存在', 'Club not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

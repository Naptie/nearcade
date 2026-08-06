import { bearerAuth, defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { usersLookupQuerySchema, usersLookupResponseSchema } from '$lib/schemas/users';

export default defineOpenApiRoute({
  get: {
    tags: ['users'],
    summary: bilingual('按社交平台账号查找用户', 'Look up users by social account', true),
    description: bilingual(
      '通过已绑定的社交平台账号（如 QQ 号）查找用户。同一账号可能对应多个用户，因此返回匹配列表，由调用方决定取用哪个。鉴权支持 SSC_SECRET、站点管理员会话，或机台 API secret（此时必须同时提供 shopId 且与机台绑定店铺一致）。',
      'Look up users by a bound social account (e.g. a verified QQ number). A social account may map to several users, so all matches are returned and the caller decides which to use. Authorized via SSC_SECRET, a site admin session, or a machine API secret (which additionally requires a matching shopId).'
    ),
    security: bearerAuth,
    requestParams: { query: usersLookupQuerySchema },
    responses: {
      '200': jsonResponse(
        bilingual('匹配的用户列表', 'Matched users', true),
        usersLookupResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('禁止访问', 'Forbidden', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

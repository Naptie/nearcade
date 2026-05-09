import {
  bearerAuth,
  defineOpenApiRoute,
  jsonRequestBody,
  jsonResponse,
  successJsonResponse
} from '$lib/openapi/route';
import {
  attendanceRegistrationCreateResponseOpenApiSchema,
  attendanceRegistrationGetResponseOpenApiSchema,
  attendanceRegistrationRequestSchema
} from '$lib/openapi/components';
import { bilingual } from '$lib/schemas/common';
import { registrationQuerySchema } from '$lib/schemas/machines';
import { shopIdParamSchema } from '$lib/schemas/shops';

export default defineOpenApiRoute({
  post: {
    tags: ['shops'],
    summary: bilingual('申请玩家登记令牌', 'Create player registration token', true),
    description: bilingual(
      '为机台槽位创建短期玩家登记令牌。',
      'Create a short-lived player registration token for a machine slot.'
    ),
    security: bearerAuth,
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(attendanceRegistrationRequestSchema),
    responses: {
      '200': jsonResponse(
        bilingual('登记令牌', 'Registration token', true),
        attendanceRegistrationCreateResponseOpenApiSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('机台凭据无效', 'Invalid machine credentials', true) },
      '403': {
        description: bilingual('机台未绑定到该店铺', 'Machine not bound to this shop', true)
      },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  get: {
    tags: ['shops'],
    summary: bilingual('获取玩家登记信息', 'Get player registration', true),
    description: bilingual('通过令牌获取玩家登记信息。', 'Get player registration data by token.'),
    security: bearerAuth,
    requestParams: {
      path: shopIdParamSchema,
      query: registrationQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('登记信息', 'Registration data', true),
        attendanceRegistrationGetResponseOpenApiSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('机台凭据无效', 'Invalid machine credentials', true) },
      '403': { description: bilingual('禁止访问', 'Forbidden', true) },
      '404': {
        description: bilingual('登记不存在或已过期', 'Registration not found or expired', true)
      },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  delete: {
    tags: ['shops'],
    summary: bilingual('销毁玩家登记令牌', 'Delete player registration token', true),
    description: bilingual('销毁玩家登记令牌。', 'Delete a player registration token.'),
    security: bearerAuth,
    requestParams: {
      path: shopIdParamSchema,
      query: registrationQuerySchema
    },
    responses: {
      '200': successJsonResponse(),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('机台凭据无效', 'Invalid machine credentials', true) },
      '404': {
        description: bilingual('登记不存在或已过期', 'Registration not found or expired', true)
      },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

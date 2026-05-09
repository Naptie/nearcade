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
import { multilingual } from '$lib/schemas/common';
import { registrationQuerySchema } from '$lib/schemas/machines';
import { shopIdParamSchema } from '$lib/schemas/shops';

export default defineOpenApiRoute({
  post: {
    tags: ['shops'],
    summary: 'Create player registration token / 申请玩家登记令牌',
    description: multilingual(
      'Create a short-lived player registration token for a machine slot.',
      '为机台槽位创建短期玩家登记令牌。'
    ),
    security: bearerAuth,
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(attendanceRegistrationRequestSchema),
    responses: {
      '200': jsonResponse(
        'Registration token / 登记令牌',
        attendanceRegistrationCreateResponseOpenApiSchema
      ),
      '400': { description: 'Bad Request / 请求错误' },
      '401': { description: 'Invalid machine credentials / 机台凭据无效' },
      '403': { description: 'Machine not bound to this shop / 机台未绑定到该店铺' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  },
  get: {
    tags: ['shops'],
    summary: 'Get player registration / 获取玩家登记信息',
    description: multilingual('Get player registration data by token.', '通过令牌获取玩家登记信息。'),
    security: bearerAuth,
    requestParams: {
      path: shopIdParamSchema,
      query: registrationQuerySchema
    },
    responses: {
      '200': jsonResponse(
        'Registration data / 登记信息',
        attendanceRegistrationGetResponseOpenApiSchema
      ),
      '400': { description: 'Bad Request / 请求错误' },
      '401': { description: 'Invalid machine credentials / 机台凭据无效' },
      '403': { description: 'Forbidden / 禁止访问' },
      '404': { description: 'Registration not found or expired / 登记不存在或已过期' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  },
  delete: {
    tags: ['shops'],
    summary: 'Delete player registration token / 销毁玩家登记令牌',
    description: multilingual('Delete a player registration token.', '销毁玩家登记令牌。'),
    security: bearerAuth,
    requestParams: {
      path: shopIdParamSchema,
      query: registrationQuerySchema
    },
    responses: {
      '200': successJsonResponse(),
      '400': { description: 'Bad Request / 请求错误' },
      '401': { description: 'Invalid machine credentials / 机台凭据无效' },
      '404': { description: 'Registration not found or expired / 登记不存在或已过期' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  }
});

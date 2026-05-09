import {
  defineOpenApiRoute,
  jsonRequestBody,
  jsonResponse,
  successJsonResponse
} from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  attendanceRequestSchema,
  attendanceResponseOpenApiSchema,
  attendanceQuerySchema,
  shopIdParamSchema
} from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取在勤人数', 'Get attendance', true),
    description: bilingual(
      '获取店铺综合、登记和上报的在勤人数。',
      'Get combined, registered, and reported attendance for a shop.'
    ),
    requestParams: {
      path: shopIdParamSchema,
      query: attendanceQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('在勤数据', 'Attendance data', true),
        attendanceResponseOpenApiSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  post: {
    tags: ['shops'],
    summary: bilingual('上报或登记在勤人数', 'Report or register attendance', true),
    description: bilingual(
      '上报当前在勤人数，或登记用户在勤。根据模式需要登录或 Bearer API 令牌。',
      'Report current attendance counts or register a user attendance session. Requires login or bearer API token depending on the mode.'
    ),
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(attendanceRequestSchema),
    responses: {
      '200': successJsonResponse(),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('禁止访问', 'Forbidden', true) },
      '404': { description: bilingual('不存在', 'Not Found', true) },
      '409': { description: bilingual('冲突', 'Conflict', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  delete: {
    tags: ['shops'],
    summary: bilingual('退勤', 'Leave attendance', true),
    description: bilingual(
      '从某店铺的当前在勤中移除当前用户。',
      'Remove the current user from active attendance at a shop.'
    ),
    requestParams: {
      path: shopIdParamSchema
    },
    responses: {
      '200': successJsonResponse(),
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '404': { description: bilingual('店铺不存在', 'Shop not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

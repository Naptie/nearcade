import {
  defineOpenApiRoute,
  jsonRequestBody,
  jsonResponse,
  successJsonResponse
} from '$lib/openapi/route';
import { attendanceRequestSchema, attendanceResponseOpenApiSchema } from '$lib/openapi/components';
import { multilingual } from '$lib/schemas/common';
import { attendanceQuerySchema, shopIdParamSchema } from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: 'Get attendance / 获取在勤人数',
    description: multilingual(
      'Get combined, registered, and reported attendance for a shop.',
      '获取店铺综合、登记和上报的在勤人数。'
    ),
    requestParams: {
      path: shopIdParamSchema,
      query: attendanceQuerySchema
    },
    responses: {
      '200': jsonResponse('Attendance data / 在勤数据', attendanceResponseOpenApiSchema),
      '400': { description: 'Bad Request / 请求错误' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  },
  post: {
    tags: ['shops'],
    summary: 'Report or register attendance / 上报或登记在勤人数',
    description: multilingual(
      'Report current attendance counts or register a user attendance session. Requires login or bearer API token depending on the mode.',
      '上报当前在勤人数，或登记用户在勤。根据模式需要登录或 Bearer API 令牌。'
    ),
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(attendanceRequestSchema),
    responses: {
      '200': successJsonResponse(),
      '400': { description: 'Bad Request / 请求错误' },
      '401': { description: 'Unauthorized / 未授权' },
      '403': { description: 'Forbidden / 禁止访问' },
      '404': { description: 'Not Found / 不存在' },
      '409': { description: 'Conflict / 冲突' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  },
  delete: {
    tags: ['shops'],
    summary: 'Leave attendance / 退勤',
    description: multilingual(
      'Remove the current user from active attendance at a shop.',
      '从某店铺的当前在勤中移除当前用户。'
    ),
    requestParams: {
      path: shopIdParamSchema
    },
    responses: {
      '200': successJsonResponse(),
      '401': { description: 'Unauthorized / 未授权' },
      '404': { description: 'Shop not found / 店铺不存在' },
      '500': { description: 'Internal Server Error / 服务器错误' }
    }
  }
});

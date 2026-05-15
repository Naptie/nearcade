import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute } from '$lib/schemas/openapi';
import { avatarUploadRequestSchema, avatarUploadResponseSchema } from '$lib/schemas/users';
import { clubIdParamSchema } from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  post: {
    tags: ['clubs'],
    summary: bilingual('上传社团头像', 'Upload club avatar', true),
    description: bilingual(
      '上传社团头像，并以 NDJSON 事件流返回上传进度与结果。',
      'Upload a club avatar and receive progress and completion events as an NDJSON stream.'
    ),
    requestParams: {
      path: clubIdParamSchema
    },
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: avatarUploadRequestSchema
        }
      }
    },
    responses: {
      '200': {
        description: bilingual('头像上传事件流', 'Avatar upload event stream', true),
        content: {
          'application/x-ndjson': {
            schema: avatarUploadResponseSchema
          }
        }
      },
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('权限不足', 'Forbidden', true) },
      '404': { description: bilingual('社团不存在', 'Club not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

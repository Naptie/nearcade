import { defineOpenApiRoute } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { avatarUploadRequestSchema, avatarUploadResponseSchema } from '$lib/schemas/users';

export default defineOpenApiRoute({
  post: {
    tags: ['users'],
    summary: bilingual('上传用户头像', 'Upload a user avatar', true),
    description: bilingual(
      '上传当前登录用户的头像，并以 NDJSON 事件流返回上传进度与结果。',
      "Upload the current signed-in user's avatar and receive progress and completion events as an NDJSON stream."
    ),
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
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

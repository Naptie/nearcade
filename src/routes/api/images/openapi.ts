import { defineOpenApiRoute } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { imageUploadEventSchema, imageUploadRequestSchema } from '$lib/schemas/images';

export default defineOpenApiRoute({
  post: {
    tags: ['images'],
    summary: bilingual('上传图片资源', 'Upload an image asset', true),
    description: bilingual(
      '上传一张图片，并可选地将其关联到店铺、评论、帖子、删除申请或草稿上下文；响应为 NDJSON 事件流。',
      'Upload an image and optionally associate it with a shop, comment, post, delete request, or draft context. The response is an NDJSON event stream.'
    ),
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: imageUploadRequestSchema
        }
      }
    },
    responses: {
      '200': {
        description: bilingual('图片上传事件流', 'Image upload event stream', true),
        content: {
          'application/x-ndjson': {
            schema: imageUploadEventSchema
          }
        }
      },
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

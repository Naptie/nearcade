import { defineOpenApiRoute, successJsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { imageIdParamSchema } from '$lib/schemas/images';

export default defineOpenApiRoute({
  delete: {
    tags: ['images'],
    summary: bilingual('删除图片资源', 'Delete an image asset', true),
    description: bilingual(
      '删除指定图片资源，并同步清理其与所属实体的关联。',
      'Delete an image asset and clean up its association with the owning entity.'
    ),
    requestParams: {
      path: imageIdParamSchema
    },
    responses: {
      '200': successJsonResponse(),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '404': { description: bilingual('图片不存在', 'Image not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

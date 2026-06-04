import { defineOpenApiRoute, successJsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { shopPhotoIdParamSchema } from '$lib/schemas/shops';

export default defineOpenApiRoute({
  delete: {
    tags: ['shops'],
    summary: bilingual('删除店铺照片', 'Delete a shop photo', true),
    description: bilingual(
      '站点管理员和照片上传者可以直接删除照片；其他用户应使用照片删除申请流程。',
      'Site administrators and the photo uploader can delete a shop photo directly. Other users should use the photo delete-request flow instead.'
    ),
    requestParams: {
      path: shopPhotoIdParamSchema
    },
    responses: {
      '200': successJsonResponse(),
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('禁止访问', 'Forbidden', true) },
      '404': { description: bilingual('店铺或照片不存在', 'Shop or photo not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

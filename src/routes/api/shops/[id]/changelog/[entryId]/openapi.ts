import { defineOpenApiRoute, successJsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { shopChangelogEntryIdParamSchema } from '$lib/schemas/shops';

export default defineOpenApiRoute({
  delete: {
    tags: ['shops'],
    summary: bilingual('删除店铺更新记录', 'Delete a shop changelog entry', true),
    description: bilingual(
      '删除指定的店铺更新记录，仅站点管理员可用。',
      'Delete a specific shop changelog entry. This endpoint is available to site administrators only.'
    ),
    requestParams: {
      path: shopChangelogEntryIdParamSchema
    },
    responses: {
      '200': successJsonResponse(),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '403': { description: bilingual('禁止访问', 'Forbidden', true) },
      '404': { description: bilingual('更新记录不存在', 'Changelog entry not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  shopChangelogListResponseSchema,
  shopChangelogQuerySchema,
  shopIdParamSchema
} from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取店铺更新记录', 'Get shop changelog', true),
    description: bilingual(
      '分页获取店铺更新记录，包括游戏、照片和删除申请相关的变更。',
      'Get paginated shop changelog entries, including changes related to games, photos, and delete requests.'
    ),
    requestParams: {
      path: shopIdParamSchema,
      query: shopChangelogQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('店铺更新记录', 'Shop changelog', true),
        shopChangelogListResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

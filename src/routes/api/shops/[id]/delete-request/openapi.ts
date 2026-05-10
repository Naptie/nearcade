import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  shopDeleteRequestByShopListResponseSchema,
  shopDeleteRequestCreateRequestSchema,
  shopDeleteRequestCreateResponseSchema,
  shopIdParamSchema
} from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取店铺删除申请', 'Get shop delete requests', true),
    description: bilingual(
      '获取指定店铺的删除申请列表，仅站点管理员可用。',
      'Get delete requests for a shop. This endpoint is available to site administrators only.'
    ),
    requestParams: {
      path: shopIdParamSchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('删除申请列表', 'Delete request list', true),
        shopDeleteRequestByShopListResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '403': { description: bilingual('禁止访问', 'Forbidden', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  post: {
    tags: ['shops'],
    summary: bilingual('提交店铺删除申请', 'Submit a shop delete request', true),
    description: bilingual(
      '为整店或店铺照片提交删除申请。若指定 `photoId`，则表示照片删除申请；否则表示整店删除申请。',
      'Submit a deletion request for an entire shop or for a specific shop photo. When `photoId` is present, this becomes a photo deletion request.'
    ),
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(shopDeleteRequestCreateRequestSchema),
    responses: {
      '201': jsonResponse(
        bilingual('已提交删除申请', 'Delete request submitted', true),
        shopDeleteRequestCreateResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '404': { description: bilingual('店铺或照片不存在', 'Shop or photo not found', true) },
      '409': { description: bilingual('已有待处理申请', 'Pending request already exists', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

import {
  defineOpenApiRoute,
  jsonRequestBody,
  jsonResponse,
  successJsonResponse
} from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  shopDeleteRequestDetailResponseSchema,
  shopDeleteRequestIdParamSchema,
  shopDeleteRequestReviewRequestSchema,
  shopDeleteRequestReviewResponseSchema
} from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取删除申请详情', 'Get delete request details', true),
    description: bilingual(
      '获取单个店铺删除申请详情及其投票汇总。',
      'Get details for a single shop delete request together with its vote summary.'
    ),
    requestParams: {
      path: shopDeleteRequestIdParamSchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('删除申请详情', 'Delete request details', true),
        shopDeleteRequestDetailResponseSchema
      ),
      '404': { description: bilingual('删除申请不存在', 'Delete request not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  delete: {
    tags: ['shops'],
    summary: bilingual('删除或撤回删除申请', 'Delete or retract a delete request', true),
    description: bilingual(
      '提交者可撤回自己的待处理申请，站点管理员可删除任意删除申请。',
      'The requester can retract their own pending request, while site administrators can delete any delete request.'
    ),
    requestParams: {
      path: shopDeleteRequestIdParamSchema
    },
    responses: {
      '200': successJsonResponse(),
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('禁止访问', 'Forbidden', true) },
      '404': { description: bilingual('删除申请不存在', 'Delete request not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  patch: {
    tags: ['shops'],
    summary: bilingual('审核删除申请', 'Review a delete request', true),
    description: bilingual(
      '由站点管理员批准或拒绝待处理的店铺删除申请。',
      'Approve or reject a pending shop delete request as a site administrator.'
    ),
    requestParams: {
      path: shopDeleteRequestIdParamSchema
    },
    requestBody: jsonRequestBody(shopDeleteRequestReviewRequestSchema),
    responses: {
      '200': jsonResponse(
        bilingual('已审核删除申请', 'Delete request reviewed', true),
        shopDeleteRequestReviewResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '403': { description: bilingual('禁止访问', 'Forbidden', true) },
      '404': { description: bilingual('删除申请不存在', 'Delete request not found', true) },
      '409': { description: bilingual('申请已被处理', 'Request has already been processed', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

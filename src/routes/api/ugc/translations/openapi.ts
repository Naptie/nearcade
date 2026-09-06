import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { ugcTranslationsRequestSchema, ugcTranslationsResponseSchema } from '$lib/schemas/ugc';

export default defineOpenApiRoute({
  post: {
    tags: ['ugc'],
    summary: bilingual('批量查询 UGC 译文缓存', 'Batch-look up cached UGC translations', true),
    description: bilingual(
      '按文本内容哈希查询已缓存的译文。仅返回缓存命中的条目；未命中的哈希不会出现在响应中，调用方应继续展示原文。可附带 `sources`（哈希→源文本），缺失的条目将被加入后台翻译队列，客户端轮询本接口即可取回结果。',
      'Look up cached translations by content hash. Only cache hits are returned — for missing hashes keep rendering the original text. Optionally include `sources` (hash → source text); missing entries are enqueued for background translation, and clients poll this endpoint to pick up the result.'
    ),
    requestBody: jsonRequestBody(ugcTranslationsRequestSchema),
    responses: {
      '200': jsonResponse(
        bilingual('命中缓存的译文', 'Cached translations', true),
        ugcTranslationsResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { metroRankingQuerySchema, metroRankingResponseSchema } from '$lib/schemas/metro';

export default defineOpenApiRoute({
  get: {
    tags: ['rankings'],
    summary: bilingual('获取地铁站排名', 'Get metro station rankings', true),
    description: bilingual(
      '读取持久化的地铁站排名，不触发同步或 API 调用。按所选维度与半径的全局顺序号升序分页（rankOrder 键为 维度_半径）；筛选网络后保留全局名次。每个条目同时携带当前维度下的全局并列名次 rank（指标相同的条目并列）。',
      'Read persisted metro station rankings without triggering sync or API calls. Paginate by ascending global order position for the selected sort key and radius (rankOrder key `sortBy_radius`); network filtering preserves global ranks. Each item also carries `rank`, the global tied rank for the requested sort (equal metrics share a rank).'
    ),
    requestParams: { query: metroRankingQuerySchema },
    responses: {
      '200': jsonResponse(
        bilingual('地铁站排名', 'Metro station rankings', true),
        metroRankingResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

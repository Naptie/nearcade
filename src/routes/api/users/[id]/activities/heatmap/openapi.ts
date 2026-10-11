import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  activityHeatmapQuerySchema,
  activityHeatmapResponseSchema,
  userRouteIdParamSchema
} from '$lib/schemas/users';

export default defineOpenApiRoute({
  get: {
    tags: ['users'],
    summary: bilingual('获取用户活动热力图', 'Get user activity heatmap', true),
    description: bilingual(
      '按天统计用户活动数量（用于个人主页的贡献热力图），遵循与活动流一致的隐私过滤。范围最长 400 天。',
      'Counts user activities per day (for the profile contribution heatmap) with the same privacy filtering as the activity feed. Range is capped at 400 days.'
    ),
    requestParams: {
      path: userRouteIdParamSchema,
      query: activityHeatmapQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('按天分组的用户活动计数', 'Per-day user activity counts', true),
        activityHeatmapResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '403': { description: bilingual('活动不可见', 'Activities are private', true) },
      '404': { description: bilingual('用户不存在', 'User not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});

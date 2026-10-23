import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual, successResponseSchema } from '$lib/schemas/common';
import {
  ugcPreferencesResponseSchema,
  ugcPreferencesUpdateRequestSchema,
  ugcTranslationsRequestSchema,
  ugcTranslationsResponseSchema
} from '$lib/schemas/ugc';

export const ugcContract = {
  /**
   * `GET /api/ugc/preferences` — the caller's AI auto-translation preferences.
   *
   * The legacy handler did *not* check the session: it answered 200 with
   * `loggedIn: false` for anonymous callers, so the endpoint keeps no guard.
   */
  getPreferences: definePublic({
    method: 'GET',
    path: '/ugc/preferences',
    operationId: 'getUgcPreferences',
    tags: ['ugc'],
    scope: 'open',
    summary: bilingual('查询 AI 自动翻译偏好', 'Get AI auto-translation preferences', true),
    description: bilingual(
      '返回当前用户开启 AI 翻译的内容类型与首次使用提示状态。未登录时返回 loggedIn=false 且不翻译任何内容。',
      "Returns the caller's opted-in translation content types and first-use prompt state. For anonymous callers, loggedIn=false and nothing is translated."
    )
  })
    .input(z.object({}))
    .output(ugcPreferencesResponseSchema),

  /** `POST /api/ugc/preferences` — update the caller's AI auto-translation preferences. */
  updatePreferences: definePublic({
    method: 'POST',
    path: '/ugc/preferences',
    operationId: 'postUgcPreferences',
    tags: ['ugc'],
    scope: 'write:account',
    guard: 'session',
    summary: bilingual('更新 AI 自动翻译偏好', 'Update AI auto-translation preferences', true),
    description: bilingual(
      '部分更新当前用户的 AI 自动翻译偏好：可勾选的内容类型，或永久关闭首次使用提示。需要登录。',
      "Partially updates the caller's AI auto-translation preferences: opted-in content types, or permanently dismissing the first-use prompt. Requires sign-in."
    )
  })
    .input(ugcPreferencesUpdateRequestSchema)
    .output(successResponseSchema),

  /** `POST /api/ugc/translations` — look up cached translations by content hash. */
  translations: definePublic({
    method: 'POST',
    path: '/ugc/translations',
    operationId: 'postUgcTranslations',
    tags: ['ugc'],
    scope: 'open',
    summary: bilingual('批量查询 UGC 译文缓存', 'Batch-look up cached UGC translations', true),
    description: bilingual(
      '按文本内容哈希查询已缓存的译文。仅返回缓存命中的条目；未命中的哈希不会出现在响应中，调用方应继续展示原文。可附带 `sources`（哈希→源文本），缺失的条目将被加入后台翻译队列，客户端轮询本接口即可取回结果。',
      'Look up cached translations by content hash. Only cache hits are returned — for missing hashes keep rendering the original text. Optionally include `sources` (hash → source text); missing entries are enqueued for background translation, and clients poll this endpoint to pick up the result.'
    )
  })
    .input(ugcTranslationsRequestSchema)
    .output(ugcTranslationsResponseSchema)
};

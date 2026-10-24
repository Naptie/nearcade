import { z } from 'zod';
import { definePrivate } from '../contract';
import { bilingual, successResponseSchema } from '$lib/schemas/common';

export const meilisearchContract = {
  /**
   * `POST /api/meilisearch/refresh` — rebuild the Meilisearch index.
   *
   * A service endpoint: the caller presents the shared `SSC_SECRET`, not a
   * user session.
   */
  refresh: definePrivate({
    method: 'POST',
    path: '/meilisearch/refresh',
    operationId: 'refreshMeilisearchIndex',
    tags: ['meilisearch'],
    guard: 'secret',
    credentials: ['secret'],
    summary: bilingual('刷新 Meilisearch 索引。', 'Refresh the Meilisearch index.', true),
    description: bilingual(
      '用 MongoDB 数据重建 Meilisearch 索引。调用方需携带 `SSC_SECRET` 服务密钥，而不是用户会话。',
      'Rebuilds the Meilisearch index from the MongoDB data. The caller presents the `SSC_SECRET` service key, not a user session.'
    )
  })
    // The legacy handler never read a body, so the endpoint has to keep
    // working for a request that sends none at all.
    .input(z.object({}).optional())
    .output(successResponseSchema)
};

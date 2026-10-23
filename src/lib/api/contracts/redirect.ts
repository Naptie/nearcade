import { z } from 'zod';
import { definePrivate } from '../contract';
import { bilingual } from '$lib/schemas/common';

export const redirectContract = {
  /**
   * `GET /api/redirect` — redirect to an allowed origin.
   *
   * The legacy handler answered with a 302 redirect, not with a JSON body, so
   * the response needs the detailed output structure.
   */
  toAllowedOrigin: definePrivate({
    method: 'GET',
    path: '/redirect',
    operationId: 'redirectToAllowedOrigin',
    tags: ['redirect'],
    outputStructure: 'detailed',
    summary: bilingual('跳转到允许的地址。', 'Redirect to an allowed origin.', true),
    description: bilingual(
      '把 `uri` 参数指定的地址连同其余查询参数一起跳转过去；目标必须以 `ALLOWED_ORIGINS` 中的某个源开头，否则返回 400。',
      'Redirects to the address in the `uri` parameter, keeping the remaining query parameters. The target must start with one of the origins in `ALLOWED_ORIGINS`, otherwise the answer is a 400.'
    )
  })
    .input(
      z.object({
        uri: z.string().describe(bilingual('跳转目标地址。', 'The target address.'))
      })
    )
    .output(
      z.object({
        status: z.literal(302).describe(bilingual('响应状态码。', 'The response status code.')),
        headers: z
          .object({
            location: z.string().describe(bilingual('跳转目标地址。', 'The target address.'))
          })
          .describe(bilingual('响应头。', 'The response headers.'))
      })
    )
};

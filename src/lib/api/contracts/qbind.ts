import { z } from 'zod';
import { definePrivate } from '../contract';
import { bilingual } from '$lib/schemas/common';

export const qbindContract = {
  /** `GET /api/qbind` — claim the QQ number a qbind token stands for. */
  claim: definePrivate({
    method: 'GET',
    path: '/qbind',
    operationId: 'claimQbindToken',
    tags: ['qbind'],
    guard: 'session',
    summary: bilingual('领取 QQ 绑定结果。', 'Claim a QQ binding result.', true),
    description: bilingual(
      '用 qbind 令牌领取已经完成的 QQ 绑定结果；需要登录。',
      'Claims the QQ binding a qbind token completed. Requires a signed-in user.'
    )
  })
    .input(
      z.object({
        token: z
          .string()
          // Nanoid tokens only contain these characters; anything else (a ":"
          // or a ".") is not a token this endpoint can ever have issued.
          .regex(/^[A-Za-z0-9_-]{10,64}$/)
          .describe(bilingual('qbind 令牌。', 'The qbind token.'))
      })
    )
    .output(
      z.object({
        success: z
          .literal(true)
          .describe(bilingual('是否成功。', 'Whether the operation succeeded.')),
        qq: z.number().describe(bilingual('已绑定的 QQ 号。', 'The QQ number that was bound.'))
      })
    ),

  /** `POST /api/qbind/token` — issue a token the qbind bot can be polled with. */
  issueToken: definePrivate({
    method: 'POST',
    path: '/qbind/token',
    operationId: 'issueQbindToken',
    tags: ['qbind'],
    guard: 'session',
    summary: bilingual('生成 qbind 令牌。', 'Issue a qbind token.', true),
    description: bilingual(
      '为当前用户生成一个 qbind 令牌，供 QQ 机器人回填绑定结果；需要登录。',
      'Issues a qbind token for the current user so the QQ bot can report the binding back. Requires a signed-in user.'
    )
  })
    // The legacy handler never read a body, so the endpoint has to keep
    // working for a request that sends none at all.
    .input(z.object({}).optional())
    .output(z.object({ token: z.string().describe(bilingual('qbind 令牌。', 'The qbind token.')) }))
};

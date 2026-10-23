import { z } from 'zod';
import { definePrivate } from '../contract';
import { bilingual, mongoIdSchema } from '$lib/schemas/common';

/**
 * A date as MongoDB stores it.
 *
 * The handler hands the driver the `Date` instance it built, and JSON has no
 * invalid date — one that could not be parsed reaches the client as `null`.
 * `z.date()` rejects it, so the check only looks at the type.
 */
const storedDateSchema = z
  .custom<Date>((value) => value instanceof Date)
  .describe(bilingual('日期。', 'Date.'))
  .meta({ override: { type: 'string', format: 'date-time' } });

/**
 * An invite link, as the `invite_links` collection stores it.
 *
 * The legacy handler returned the raw MongoDB document, so the object stays
 * loose: the fields below are documented and every other key is passed
 * through unchanged.
 */
const inviteLinkSchema = z.looseObject({
  _id: mongoIdSchema,
  id: z.string().describe(bilingual('邀请 ID。', 'Invite ID.')),
  code: z.string().describe(bilingual('邀请码。', 'Invite code.')),
  type: z.enum(['university', 'club']).describe(bilingual('邀请类型。', 'Invite type.')),
  targetId: z.string().describe(bilingual('目标 ID。', 'Target ID.')),
  createdBy: z.string().describe(bilingual('创建者用户 ID。', 'Creator user ID.')),
  title: z.string().nullable().optional().describe(bilingual('标题。', 'Title.')),
  description: z.string().nullable().optional().describe(bilingual('描述。', 'Description.')),
  maxUses: z
    .number()
    .nullable()
    .optional()
    .describe(
      bilingual('最大使用次数；null 表示不限。', 'Maximum number of uses; null means unlimited.')
    ),
  currentUses: z.number().describe(bilingual('已使用次数。', 'Number of uses so far.')),
  expiresAt: z
    .union([storedDateSchema, z.null()])
    .optional()
    .describe(
      bilingual('过期时间；null 表示不过期。', 'Expiration time; null means it never expires.')
    ),
  requireApproval: z
    .boolean()
    .describe(
      bilingual('是否需要管理员审批。', 'Whether an administrator has to approve the join.')
    ),
  isActive: z.boolean().describe(bilingual('是否可用。', 'Whether the invite is active.')),
  createdAt: storedDateSchema.describe(bilingual('创建时间。', 'Creation time.')),
  updatedAt: storedDateSchema.optional().describe(bilingual('更新时间。', 'Update time.'))
});

/** The response of `POST /api/invites`. */
export const inviteResponseSchema = z.object({
  invite: inviteLinkSchema.describe(bilingual('新建的邀请链接。', 'The created invite link.'))
});

/** The response of `POST /api/invites/{code}/redeem`. */
export const inviteRedeemResponseSchema = z.object({
  success: z.boolean().describe(bilingual('是否成功。', 'Whether the operation succeeded.')),
  message: z.string().describe(bilingual('结果说明。', 'Result message.')),
  requiresApproval: z
    .boolean()
    .describe(
      bilingual('是否需要等待管理员审批。', 'Whether an administrator still has to approve.')
    )
});

export const invitesContract = {
  /** `POST /api/invites` — create an invite link. */
  create: definePrivate({
    method: 'POST',
    path: '/invites',
    operationId: 'createInvite',
    tags: ['invites'],
    guard: 'session',
    summary: bilingual('创建邀请链接。', 'Create an invite link.', true),
    description: bilingual(
      '为某个学校或社团创建一条邀请链接；需要登录。',
      'Creates an invite link for a university or a club. Requires a signed-in user.'
    )
  })
    .input(
      z.object({
        type: z
          .string()
          .optional()
          .describe(
            bilingual('邀请类型：`university` 或 `club`。', 'Invite type: `university` or `club`.')
          ),
        targetId: z.string().optional().describe(bilingual('目标 ID。', 'Target ID.')),
        title: z.string().nullable().optional().describe(bilingual('标题。', 'Title.')),
        description: z.string().nullable().optional().describe(bilingual('描述。', 'Description.')),
        expiresAt: z
          .string()
          .nullable()
          .optional()
          .describe(bilingual('过期时间。', 'Expiration time.')),
        maxUses: z
          .number()
          .nullable()
          .optional()
          .describe(bilingual('最大使用次数。', 'Maximum number of uses.')),
        requireApproval: z
          .boolean()
          .optional()
          .describe(
            bilingual('是否需要管理员审批。', 'Whether an administrator has to approve the join.')
          )
      })
    )
    .output(inviteResponseSchema),

  /** `POST /api/invites/{code}/redeem` — redeem an invite link. */
  redeem: definePrivate({
    method: 'POST',
    path: '/invites/{code}/redeem',
    operationId: 'redeemInvite',
    tags: ['invites'],
    guard: 'session',
    summary: bilingual('兑换邀请链接。', 'Redeem an invite link.', true),
    description: bilingual(
      '使用邀请码加入对应的学校或社团；需要登录。',
      'Joins the university or the club the invite code points at. Requires a signed-in user.'
    )
  })
    .input(z.object({ code: z.string().describe(bilingual('邀请码。', 'Invite code.')) }))
    .output(inviteRedeemResponseSchema)
};

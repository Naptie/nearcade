import { z } from 'zod';
import { bilingual, successResponseSchema } from './common';

export const activateMachineQuerySchema = z.object({
  sn: z.string().min(1).describe(bilingual('机台序列号。', 'Machine serial number.'))
});

export const activateMachineResponseSchema = successResponseSchema.extend({
  apiSecret: z
    .string()
    .describe(
      bilingual('生成的机台 API 密钥。', 'Generated API secret for the activated machine.')
    ),
  shop: z
    .object({
      id: z.int(),
      name: z.string(),
      source: z.string().optional()
    })
    .nullable()
    .describe(bilingual('机台绑定的店铺。', 'Shop bound to the machine.'))
});

export const registrationBodySchema = z.object({
  slotIndex: z.string().min(1).describe(bilingual('槽位编号。', 'Slot index.')),
  expires: z
    .int()
    .min(10)
    .optional()
    .describe(bilingual('过期时间，单位：秒。', 'Expiration time in seconds.'))
});

export const registrationQuerySchema = z.object({
  token: z.string().min(1).describe(bilingual('玩家登记令牌。', 'Player registration token.'))
});

export const registrationCreateResponseSchema = successResponseSchema.extend({
  token: z.string(),
  expiresAt: z.string(),
  shopName: z.string().nullable()
});

export const registrationGetResponseSchema = successResponseSchema.extend({
  registration: z.object({
    shopId: z.string(),
    machineId: z.string(),
    slotIndex: z.string(),
    expiresAt: z.string(),
    userId: z.string().optional(),
    user: z.unknown().optional()
  })
});

export type RegistrationBody = z.infer<typeof registrationBodySchema>;

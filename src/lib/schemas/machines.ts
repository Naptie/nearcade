import { z } from 'zod';
import { multilingual, successResponseSchema } from './common';

export const activateMachineQuerySchema = z.object({
  sn: z.string().min(1).describe(multilingual('Machine serial number.', '机台序列号。'))
});

export const activateMachineResponseSchema = successResponseSchema.extend({
  apiSecret: z
    .string()
    .describe(
      multilingual('Generated API secret for the activated machine.', '生成的机台 API 密钥。')
    ),
  shop: z
    .object({
      id: z.int(),
      name: z.string(),
      source: z.string().optional()
    })
    .nullable()
    .describe(multilingual('Shop bound to the machine.', '机台绑定的店铺。'))
});

export const registrationBodySchema = z.object({
  slotIndex: z.string().min(1).describe(multilingual('Slot index.', '槽位编号。')),
  expires: z
    .int()
    .min(10)
    .optional()
    .describe(multilingual('Expiration time in seconds.', '过期时间，单位：秒。'))
});

export const registrationQuerySchema = z.object({
  token: z.string().min(1).describe(multilingual('Player registration token.', '玩家登记令牌。'))
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

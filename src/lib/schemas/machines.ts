import { z } from 'zod';
import { bilingual, successResponseSchema, userIdSchema, userPublicSchema } from './common';
import { queueSlotIndexSchema, shopNameSchema, shopSummarySchema } from './shops';

const machineSerialNumberSchema = z
  .string()
  .min(1)
  .describe(bilingual('机台序列号。', 'Machine serial number.'));
const machineApiSecretSchema = z
  .string()
  .describe(bilingual('生成的机台 API 密钥。', 'Generated API secret for the activated machine.'));
const registrationExpiresSchema = z
  .int()
  .min(10)
  .optional()
  .describe(bilingual('过期时间，单位：秒。', 'Expiration time in seconds.'));
const registrationTokenSchema = z
  .string()
  .min(1)
  .describe(bilingual('玩家登记令牌。', 'Player registration token.'));
const expiresAtSchema = z.iso.datetime().describe(bilingual('过期时间。', 'Expiration time.'));
const machineIdSchema = z.string().describe(bilingual('机台 ID。', 'Machine ID.'));
const shopIdStringSchema = z.string().describe(bilingual('店铺 ID。', 'Shop ID.'));

export const activateMachineQuerySchema = z.object({
  sn: machineSerialNumberSchema
});

export const activateMachineResponseSchema = successResponseSchema.extend({
  apiSecret: machineApiSecretSchema,
  shop: shopSummarySchema
    .nullable()
    .describe(bilingual('机台绑定的店铺。', 'Shop bound to the machine.'))
});

export const registrationBodySchema = z.object({
  slotIndex: queueSlotIndexSchema.describe(bilingual('槽位编号。', 'Slot index.')),
  expires: registrationExpiresSchema
});

export const registrationQuerySchema = z.object({
  token: registrationTokenSchema
});

export const registrationCreateResponseSchema = successResponseSchema.extend({
  token: registrationTokenSchema.describe(
    bilingual('生成的玩家登记令牌。', 'Generated player registration token.')
  ),
  expiresAt: expiresAtSchema,
  shopName: shopNameSchema.nullable().describe(bilingual('店铺名称。', 'Shop name.'))
});

export const registrationGetResponseSchema = successResponseSchema.extend({
  registration: z
    .object({
      shopId: shopIdStringSchema,
      machineId: machineIdSchema,
      slotIndex: queueSlotIndexSchema,
      expiresAt: expiresAtSchema,
      userId: userIdSchema.optional().describe(bilingual('用户 ID。', 'User ID.')),
      user: userPublicSchema.optional().describe(bilingual('关联用户。', 'Associated user.'))
    })
    .describe(bilingual('登记令牌信息。', 'Registration token details.'))
});

export type RegistrationBody = z.infer<typeof registrationBodySchema>;

export const machineActivationResponseOpenApiSchema = activateMachineResponseSchema.meta({
  id: 'MachineActivationResponse'
});
export const attendanceRegistrationRequestSchema = registrationBodySchema.meta({
  id: 'AttendanceRegistrationRequest'
});
export const attendanceRegistrationCreateResponseOpenApiSchema =
  registrationCreateResponseSchema.meta({ id: 'AttendanceRegistrationCreateResponse' });
export const attendanceRegistrationGetResponseOpenApiSchema = registrationGetResponseSchema.meta({
  id: 'AttendanceRegistrationGetResponse'
});

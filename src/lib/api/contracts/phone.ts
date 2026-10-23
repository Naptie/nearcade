import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual } from '$lib/schemas/common';

/** The result of asking the SMS provider to send a verification code. */
const phoneOtpSendResultSchema = z.union([
  z.object({
    success: z.literal(true),
    method: z.literal('sms'),
    requestId: z.string().optional().describe(bilingual('短信请求 ID。', 'SMS request ID.'))
  }),
  z.object({
    success: z.literal(true),
    method: z.literal('telegram'),
    sessionId: z.string().describe(bilingual('Telegram 会话 ID。', 'Telegram session ID.')),
    deepLink: z.string().describe(bilingual('Telegram 深链。', 'Telegram deep link.')),
    expiresAt: z.string().describe(bilingual('过期时间。', 'Expiry time.')),
    ttl: z.number().describe(bilingual('有效期（秒）。', 'Time to live in seconds.'))
  })
]);

/** The state of a Telegram verification session. */
const phoneVerificationStatusSchema = z.union([
  z.object({
    success: z.literal(true),
    status: z.literal('pending')
  }),
  z.object({
    success: z.literal(true),
    status: z.literal('verified'),
    verifiedNumber: z.string().describe(bilingual('已验证的号码。', 'Verified number.'))
  }),
  z.object({
    success: z.literal(true),
    status: z.literal('expired')
  })
]);

export const phoneContract = {
  /** `DELETE /api/phone` — unbind the phone number from the signed-in user. */
  remove: definePublic({
    method: 'DELETE',
    path: '/phone',
    operationId: 'removePhoneNumber',
    tags: ['phone'],
    scope: null,
    guard: 'session',
    summary: bilingual('解绑手机号。', 'Unbind the phone number.', true),
    description: bilingual(
      '解除当前登录用户绑定的手机号与国家/地区拨号代码，需要登录。',
      'Clears the phone number and dial code of the signed-in user. Requires a signed-in user.'
    )
  })
    .input(z.object({}).optional())
    .output(z.object({ success: z.literal(true) })),

  /** `POST /api/phone/send` — send a verification code to a phone number. */
  send: definePublic({
    method: 'POST',
    path: '/phone/send',
    operationId: 'sendPhoneVerificationCode',
    tags: ['phone'],
    scope: null,
    guard: 'session',
    summary: bilingual('发送手机验证码。', 'Send a phone verification code.', true),
    description: bilingual(
      '向指定手机号发送验证码，或创建 Telegram 验证会话。手机号与拨号代码必填；配置了验证码服务时还需要验证码令牌。',
      'Sends a verification code to a phone number, or opens a Telegram verification session. The phone number and dial code are required; a captcha token is required when a captcha provider is configured.'
    )
  })
    .input(
      z.object({
        phoneNumber: z
          .string()
          .describe(
            bilingual(
              '手机号（不含国家/地区代码）。必填。',
              'Phone number without dial code. Required.'
            )
          ),
        dialCode: z
          .string()
          .describe(bilingual('国家/地区拨号代码。必填。', 'Dial code. Required.')),
        locale: z.string().optional().describe(bilingual('界面语言。', 'Interface locale.')),
        captchaProvider: z
          .string()
          .optional()
          .describe(bilingual('验证码服务名称。', 'Captcha provider name.')),
        captchaToken: z.string().optional().describe(bilingual('验证码令牌。', 'Captcha token.')),
        turnstileToken: z
          .string()
          .optional()
          .describe(bilingual('Turnstile 令牌（旧版字段）。', 'Turnstile token (legacy field).')),
        hcaptchaToken: z
          .string()
          .optional()
          .describe(bilingual('hCaptcha 令牌（旧版字段）。', 'hCaptcha token (legacy field).'))
      })
    )
    .output(phoneOtpSendResultSchema),

  /** `GET /api/phone/status/{sessionId}` — poll a Telegram verification session. */
  status: definePublic({
    method: 'GET',
    path: '/phone/status/{sessionId}',
    operationId: 'getPhoneVerificationStatus',
    tags: ['phone'],
    scope: null,
    guard: 'session',
    summary: bilingual('查询手机号验证状态。', 'Get the phone verification status.', true),
    description: bilingual(
      '查询 Telegram 验证会话的状态。验证通过时会把手机号绑定到当前登录用户，需要登录。',
      'Reports the state of a Telegram verification session. A verified session binds the phone number to the signed-in user. Requires a signed-in user.'
    )
  })
    .input(
      z.object({
        sessionId: z.string().describe(bilingual('验证会话 ID。', 'Verification session ID.')),
        locale: z.string().optional().describe(bilingual('界面语言。', 'Interface locale.'))
      })
    )
    .output(phoneVerificationStatusSchema),

  /** `POST /api/phone/verify` — verify a code and bind the phone number. */
  verify: definePublic({
    method: 'POST',
    path: '/phone/verify',
    operationId: 'verifyPhoneCode',
    tags: ['phone'],
    scope: null,
    guard: 'session',
    summary: bilingual('验证手机号。', 'Verify a phone number.', true),
    description: bilingual(
      '校验短信验证码；通过后把手机号绑定到当前登录用户，需要登录。',
      'Checks the SMS verification code and binds the phone number to the signed-in user on success. Requires a signed-in user.'
    )
  })
    .input(
      z.object({
        phoneNumber: z
          .string()
          .describe(
            bilingual(
              '手机号（不含国家/地区代码）。必填。',
              'Phone number without dial code. Required.'
            )
          ),
        dialCode: z
          .string()
          .describe(bilingual('国家/地区拨号代码。必填。', 'Dial code. Required.')),
        code: z
          .string()
          .describe(bilingual('短信验证码。必填。', 'SMS verification code. Required.')),
        locale: z.string().optional().describe(bilingual('界面语言。', 'Interface locale.'))
      })
    )
    .output(
      z.object({
        success: z
          .boolean()
          .describe(bilingual('是否验证通过。', 'Whether the code was accepted.')),
        verified: z
          .boolean()
          .describe(bilingual('号码是否已验证。', 'Whether the number is verified.'))
      })
    )
};

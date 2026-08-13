import { SSC_SECRET } from '$env/static/private';
import { env } from '$env/dynamic/private';
import { createClient, type Client } from 'unified-sms-client';

const SMS_BASE_URL = env.UNIFIED_SMS_URL ?? 'http://localhost:7272';

let _client: ReturnType<typeof createClient> | undefined;

function getClient() {
  if (!_client) {
    _client = createClient(SMS_BASE_URL, {
      headers: { authorization: `Bearer ${SSC_SECRET}` }
    });
  }
  return _client;
}

// ---- Result types, derived from the typed client ----

type RegionsData = NonNullable<Awaited<ReturnType<Client['regions']['get']>>['data']>;
export type SupportedRegion = RegionsData[number];

type SendData = NonNullable<Awaited<ReturnType<Client['sms']['send']['post']>>['data']>;
export type SendOtpResult = SendData | { success: false; error: string };

type VerifyData = NonNullable<Awaited<ReturnType<Client['sms']['verify']['post']>>['data']>;
export type VerifyOtpResult = VerifyData | { success: false; error: string };

type StatusData = NonNullable<
  Awaited<ReturnType<ReturnType<Client['sms']['status']>['get']>>['data']
>;
export type TelegramStatusResult = StatusData | { success: false; error: string };

type SendBody = Parameters<Client['sms']['send']['post']>[0];
/** Locale for error messages and the Telegram bot conversation. */
export type SmsLocale = NonNullable<SendBody['locale']>;

// ---- API wrappers ----

export async function getSupportedRegions(): Promise<SupportedRegion[]> {
  const client = getClient();
  const { data, error } = await client.regions.get();
  if (error || !data) return [];
  return data;
}

export async function sendPhoneOtp(
  phoneNumber: string,
  dialCode: string,
  locale: SmsLocale
): Promise<SendOtpResult> {
  const client = getClient();
  const { data, error } = await client.sms.send.post({
    phoneNumber,
    dialCode,
    codeLength: 6,
    locale
  });
  if (error) {
    return {
      success: false,
      error: (error.value as { error?: string })?.error ?? 'sms_send_failed'
    };
  }
  return data;
}

export async function verifyPhoneOtp(
  phoneNumber: string,
  dialCode: string,
  code: string,
  locale: SmsLocale
): Promise<VerifyOtpResult> {
  const client = getClient();
  const { data, error } = await client.sms.verify.post({ phoneNumber, dialCode, code, locale });
  if (error) {
    return {
      success: false,
      error: (error.value as { error?: string })?.error ?? 'sms_verify_failed'
    };
  }
  return data;
}

export async function getTelegramVerificationStatus(
  sessionId: string,
  locale: SmsLocale
): Promise<TelegramStatusResult> {
  const client = getClient();
  const { data, error } = await client.sms.status({ sessionId }).get({ query: { locale } });
  if (error) {
    return {
      success: false,
      error: (error.value as { error?: string })?.error ?? 'telegram_status_failed'
    };
  }
  return data;
}

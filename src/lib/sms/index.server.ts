import { SSC_SECRET } from '$env/static/private';
import { env } from '$env/dynamic/private';
import { createClient } from 'unified-sms-client';

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

export async function getSupportedCountries(): Promise<
  Array<{ dialCode: string; name: string; isoCode: string }>
> {
  const client = getClient();
  const { data, error } = await client.countries.get();
  if (error || !data) return [];
  return data as Array<{ dialCode: string; name: string; isoCode: string }>;
}

export async function sendPhoneOtp(
  phoneNumber: string,
  countryCode: string
): Promise<{ success: true; requestId?: string } | { success: false; error: string }> {
  const client = getClient();
  const { data, error } = await client.sms.send.post({ phoneNumber, countryCode, codeLength: 6 });
  if (error) {
    return {
      success: false,
      error: (error.value as { error?: string })?.error ?? 'sms_send_failed'
    };
  }
  return data as { success: true; requestId?: string };
}

export async function verifyPhoneOtp(
  phoneNumber: string,
  countryCode: string,
  code: string
): Promise<{ success: true; verified: boolean } | { success: false; error: string }> {
  const client = getClient();
  const { data, error } = await client.sms.verify.post({ phoneNumber, countryCode, code });
  if (error) {
    return {
      success: false,
      error: (error.value as { error?: string })?.error ?? 'sms_verify_failed'
    };
  }
  return data as { success: true; verified: boolean };
}

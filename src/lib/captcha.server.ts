import { env } from '$env/dynamic/private';

export type CaptchaProvider = 'turnstile' | 'hcaptcha';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

/** List of captcha providers that are fully configured in the environment. */
export function getConfiguredCaptchaProviders(): CaptchaProvider[] {
  const providers: CaptchaProvider[] = [];

  if (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) {
    providers.push('turnstile');
  }

  if (env.HCAPTCHA_SITE_KEY && env.HCAPTCHA_SECRET_KEY) {
    providers.push('hcaptcha');
  }

  return providers;
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Skip verification if not configured
  const resp = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: token, remoteip: ip })
  });
  if (!resp.ok) return false;
  const data = (await resp.json()) as { success: boolean };
  return data.success === true;
}

async function verifyHcaptcha(token: string, ip: string): Promise<boolean> {
  const secret = env.HCAPTCHA_SECRET_KEY;
  if (!secret) return true;

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: ip,
    ...(env.HCAPTCHA_SITE_KEY ? { sitekey: env.HCAPTCHA_SITE_KEY } : {})
  });

  const resp = await fetch(HCAPTCHA_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!resp.ok) return false;
  const data = (await resp.json()) as { success: boolean };
  return data.success === true;
}

/** Verify a captcha token with the given provider. */
export async function verifyCaptcha(
  provider: CaptchaProvider,
  token: string,
  ip: string
): Promise<boolean> {
  if (provider === 'turnstile') return verifyTurnstile(token, ip);
  return verifyHcaptcha(token, ip);
}

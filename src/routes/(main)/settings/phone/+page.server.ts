import type { PageServerLoad } from './$types';
import { getSupportedRegions } from '$lib/sms/index.server';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();
  const regions = await getSupportedRegions();
  return {
    phone: user.phone ?? null,
    phoneDialCode: user.phoneDialCode ?? null,
    regions,
    turnstileSiteKey:
      env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null,
    hcaptchaSiteKey: env.HCAPTCHA_SITE_KEY && env.HCAPTCHA_SECRET_KEY ? env.HCAPTCHA_SITE_KEY : null
  };
};

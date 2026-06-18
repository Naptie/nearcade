import type { PageServerLoad } from './$types';
import { getSupportedCountries } from '$lib/sms/index.server';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();
  const countries = await getSupportedCountries();
  return {
    phone: user.phone ?? null,
    phoneCountryCode: user.phoneCountryCode ?? null,
    countries,
    turnstileSiteKey:
      env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null,
    hcaptchaSiteKey: env.HCAPTCHA_SITE_KEY && env.HCAPTCHA_SECRET_KEY ? env.HCAPTCHA_SITE_KEY : null
  };
};

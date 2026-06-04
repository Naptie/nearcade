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
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null
  };
};

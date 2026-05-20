import type { PageServerLoad } from './$types';
import { getSupportedCountries } from '$lib/sms/index.server';

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();
  const countries = await getSupportedCountries();
  return {
    phone: user.phone ?? null,
    phoneCountryCode: user.phoneCountryCode ?? null,
    countries
  };
};

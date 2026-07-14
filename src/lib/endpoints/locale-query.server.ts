import type { Handle } from '@sveltejs/kit';
import { locales } from '$lib/paraglide/runtime';
import { setRequestCookie } from '$lib/utils/cookie';

const COOKIE_NAME = 'PARAGLIDE_LOCALE';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400; // ~1 year, matching Paraglide default

export const handleLocaleQuery: Handle = async ({ event, resolve }) => {
  const locale = event.url.searchParams.get('locale');

  if (locale && (locales as readonly string[]).includes(locale)) {
    event.request = setRequestCookie(event.request, COOKIE_NAME, locale);
    event.cookies.set(COOKIE_NAME, locale, {
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
      sameSite: 'lax'
    });
  }

  return resolve(event);
};

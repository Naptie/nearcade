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

    // Store the locale in locals so we can inject it into the page
    event.locals.localeOverride = locale;
  }

  return resolve(event, {
    transformPageChunk: ({ html, done }) => {
      if (done && locale && (locales as readonly string[]).includes(locale)) {
        // Inject script before closing </head> to set localStorage before hydration
        return html.replace(
          '</head>',
          `<script>try{localStorage.setItem('${COOKIE_NAME}','${locale}')}catch(e){}</script></head>`
        );
      }
      return html;
    }
  });
};

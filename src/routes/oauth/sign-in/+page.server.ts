import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const session = event.locals.session;
  if (session) {
    redirect(
      302,
      `/oauth/consent${event.url.search ? `?${event.url.searchParams.toString()}` : ''}`
    );
  }
};

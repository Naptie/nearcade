import { loginRedirect } from '$lib/utils/scoped';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = locals.session;
  // Redirect to sign in if not authenticated
  if (!session) {
    throw loginRedirect(url);
  }

  return {};
};

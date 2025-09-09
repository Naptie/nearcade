import { loginRedirect } from '$lib/utils/scoped';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();
  // Redirect to sign in if not authenticated
  if (!session) {
    throw loginRedirect(url);
  }

  return {
    user: session.user
  };
};

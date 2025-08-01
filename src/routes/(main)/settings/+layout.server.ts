import { base } from '$app/paths';
import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ locals }) => {
  const session = await locals.auth();
  // Redirect to sign in if not authenticated
  if (!session) {
    throw redirect(302, `${base}/`);
  }

  return {
    user: session.user
  };
};

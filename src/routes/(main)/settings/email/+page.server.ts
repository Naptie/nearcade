import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
  EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM,
  requiresEmailBinding,
  sanitizeRedirectTarget
} from '$lib/auth/email';

export const load: PageServerLoad = async ({ parent, url }) => {
  const { user } = await parent();
  const redirectTo = sanitizeRedirectTarget(url.searchParams.get('continue'), url.origin);
  const prompt = url.searchParams.get('prompt') === '1';
  const needsEmailBinding = requiresEmailBinding(user);
  const verificationError = url.searchParams.get('error');
  const verificationSucceeded =
    url.searchParams.get(EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM) === '1' && !verificationError;

  if (prompt && redirectTo && !needsEmailBinding && !verificationSucceeded) {
    redirect(303, redirectTo);
  }

  return {
    user,
    prompt,
    redirectTo,
    needsEmailBinding,
    verificationError,
    verificationSucceeded
  };
};

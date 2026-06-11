import type { PageServerLoad } from './$types';
import { auth } from '$lib/auth/index.server';
import { QR_SESSION_TTL } from '$lib/constants';

export const load: PageServerLoad = async ({ request, locals }) => {
  const session = locals.session;
  if (!session) {
    return { authenticated: false as const, token: null, expiresAt: null };
  }

  // The user is authenticated in this browser (the callback browser).
  // Generate a one-time token so the original browser can redeem it.
  const generated = await auth.api.generateOneTimeToken({ headers: request.headers });

  return {
    authenticated: true as const,
    token: generated.token,
    expiresAt: new Date(Date.now() + QR_SESSION_TTL * 1000).toISOString()
  };
};

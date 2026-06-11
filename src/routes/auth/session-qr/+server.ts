import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/auth/index.server';
import { parseSetCookieHeader } from 'better-auth/cookies';

/**
 * QR session callback — GET /auth/session-qr?t=<token>
 *
 * The token is a Better Auth one-time token valid for 2 minutes.
 * We POST it to the Better Auth verify endpoint and explicitly forward
 * any Set-Cookie headers onto the current event via `cookies.set()`,
 * guaranteeing the session cookie is included in the redirect response.
 *
 * Using a query param keeps the token out of the path and allows the same
 * handoff primitive to be rendered either as a QR code or as a copy/paste code.
 */
export const GET: RequestHandler = async ({ url, request, cookies, locals }) => {
  // Already logged in — just send home.
  if (locals.session) {
    redirect(302, '/');
  }

  const token = url.searchParams.get('t');

  if (!token) {
    error(400, 'Invalid QR token');
  }

  // Call the Better Auth one-time-token verify endpoint.
  const verifyUrl = new URL('/api/auth/one-time-token/verify', request.url);
  let authResponse: Response;
  try {
    authResponse = await auth.handler(
      new Request(verifyUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })
    );
  } catch (err) {
    console.error('[session-handoff callback] auth.handler error:', err);
    error(500, 'Session creation failed');
  }

  if (!authResponse.ok) {
    let msg = 'Invalid or expired QR code';
    try {
      const body = (await authResponse.json()) as { message?: string };
      if (body.message) msg = body.message;
    } catch {
      // ignore
    }
    error(400, msg);
  }

  // Explicitly forward cookies from the auth response to the SvelteKit event.
  // This mirrors what sveltekitCookies does in the handle hook but is applied
  // directly here so the cookie is present on the redirect response.
  const setCookieHeader = authResponse.headers.get('set-cookie');
  if (setCookieHeader) {
    const parsed = parseSetCookieHeader(setCookieHeader);
    for (const [name, attrs] of parsed) {
      try {
        cookies.set(name, attrs.value, {
          path: attrs.path ?? '/',
          domain: attrs.domain,
          secure: attrs.secure,
          httpOnly: attrs.httponly,
          sameSite: attrs.samesite as 'lax' | 'strict' | 'none' | undefined,
          maxAge: attrs['max-age'],
          expires: attrs.expires,
          partitioned: attrs.partitioned
        });
      } catch (e) {
        console.warn('[session-handoff callback] failed to set cookie', name, e);
      }
    }
  }

  redirect(302, '/');
};

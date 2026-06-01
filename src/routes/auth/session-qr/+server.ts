import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/auth/index.server';
import { parseSetCookieHeader } from 'better-auth/cookies';

/**
 * QR session callback — GET /auth/session-qr?t=<token>
 *
 * The token is a 64-char hex string stored in Redis for 2 minutes.
 * We POST it to the Better Auth verify endpoint and explicitly forward
 * any Set-Cookie headers onto the current event via `cookies.set()`,
 * guaranteeing the session cookie is included in the redirect response.
 *
 * Using a query param keeps the token out of server-side access logs and
 * prevents it from appearing in URL-based search-engine indexing.
 */
export const GET: RequestHandler = async ({ url, request, cookies, locals }) => {
  // Already logged in — just send home.
  if (locals.session) {
    redirect(302, '/');
  }

  const token = url.searchParams.get('t');

  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    error(400, 'Invalid QR token');
  }

  // Call the custom Better Auth verify endpoint.
  const verifyUrl = new URL('/api/auth/session-qr/verify', request.url);
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
    console.error('[session-qr callback] auth.handler error:', err);
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
        console.warn('[session-qr callback] failed to set cookie', name, e);
      }
    }
  }

  redirect(302, '/');
};

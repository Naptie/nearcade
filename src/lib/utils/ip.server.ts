import type { RequestEvent } from '@sveltejs/kit';

/**
 * Extracts the real client IP address from request headers.
 * Checks CF-Connecting-IP, Ali-CDN-Real-IP, and X-Forwarded-For in that order.
 * Falls back to getClientAddress() if no proxy headers are present.
 */
export function getClientIp(event: RequestEvent): string {
  const cfIp = event.request.headers.get('cf-connecting-ip');
  const aliIp = event.request.headers.get('ali-cdn-real-ip');
  const xff = event.request.headers.get('x-forwarded-for');

  const forwarded = cfIp || aliIp || xff?.split(',')[0]?.trim();
  if (forwarded) return forwarded;

  try {
    return event.getClientAddress();
  } catch {
    return 'unknown';
  }
}

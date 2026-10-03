/**
 * CORS origin policy shared by hooks (global ACAO stamping) and individual
 * endpoints that must gate quota-bearing lookups (e.g. coordinate translation).
 *
 * - No Origin header → same-origin request or non-browser client: allowed.
 * - Origin equal to the request's own origin → same-origin: allowed.
 * - Origin in `CORS_ALLOWED_ORIGINS` (or loopback for local dev) → allowed.
 * - Anything else → not allowed (a browser cannot read the response).
 */
import { CORS_ALLOWED_ORIGINS } from '$env/static/private';

const CORS_ALLOWED_ORIGIN_SET = new Set(
  CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

// Loopback origins are always allowed for local development.
const LOCAL_DEV_CORS_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export const isAllowedCorsOrigin = (origin: string | null, requestOrigin: string): boolean => {
  if (!origin) return true;
  if (origin === requestOrigin) return true;
  return CORS_ALLOWED_ORIGIN_SET.has(origin) || LOCAL_DEV_CORS_ORIGIN_PATTERN.test(origin);
};

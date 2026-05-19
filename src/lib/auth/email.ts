export const EMAIL_PLACEHOLDER_SUFFIX = '.nearcade';
export const EMAIL_SETTINGS_ROUTE = '/settings/email';
export const POST_LOGIN_EMAIL_PROMPT_QUERY_PARAM = 'justSignedIn';
export const EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM = 'emailVerified';

type EmailBindingUser = {
  email?: string | null;
  emailVerified?: boolean | null;
};

export function isPlaceholderEmail(email?: string | null): boolean {
  return !!email && email.endsWith(EMAIL_PLACEHOLDER_SUFFIX);
}

export function hasBoundEmail(email?: string | null): boolean {
  return !!email && !isPlaceholderEmail(email);
}

export function requiresEmailBinding(user?: EmailBindingUser | null): boolean {
  if (!user?.email) {
    return true;
  }

  return isPlaceholderEmail(user.email) || user.emailVerified !== true;
}

export function toRelativeUrl(url: URL): string {
  return `${url.pathname}${url.search}`;
}

export function stripPostLoginMarker(url: URL): string {
  const next = new URL(url);
  next.searchParams.delete(POST_LOGIN_EMAIL_PROMPT_QUERY_PARAM);
  next.searchParams.delete('login');
  return toRelativeUrl(next);
}

export function withPostLoginMarker(url: URL): string {
  const next = new URL(url);
  next.searchParams.delete('login');
  next.searchParams.set(POST_LOGIN_EMAIL_PROMPT_QUERY_PARAM, '1');
  return toRelativeUrl(next);
}

export function withEmailVerificationSuccessMarker(url: URL): string {
  const next = new URL(url);
  next.searchParams.delete('login');
  next.searchParams.delete(POST_LOGIN_EMAIL_PROMPT_QUERY_PARAM);
  next.searchParams.delete('error');
  next.searchParams.set(EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM, '1');
  return toRelativeUrl(next);
}

export function stripEmailVerificationStatus(url: URL): string {
  const next = new URL(url);
  next.searchParams.delete(EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM);
  next.searchParams.delete('error');
  return toRelativeUrl(next);
}

export function sanitizeRedirectTarget(
  input: string | null | undefined,
  origin: string
): string | null {
  if (!input) {
    return null;
  }

  try {
    const url = new URL(input, origin);
    if (url.origin !== origin) {
      return null;
    }

    return toRelativeUrl(url);
  } catch {
    return null;
  }
}

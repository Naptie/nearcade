import { m } from '$lib/paraglide/messages';

/**
 * Central mapping from server-side status message keys to localized strings.
 *
 * Server actions return terse keys (e.g. `sessions_revoked`) instead of raw
 * strings so the client can localize them. Each page used to re-implement this
 * switch; now it lives in one place. Unknown keys fall through unchanged so any
 * raw localized string returned by the server still displays correctly.
 */
const STATUS_MESSAGES: Record<string, () => string> = {
  // ── Sessions ──────────────────────────────────────────────────────────────
  sessions_revoked: () => m.sessions_revoked(),
  sessions_all_others_revoked: () => m.sessions_all_others_revoked(),
  sessions_oauth_revoked: () => m.sessions_oauth_revoked(),
  sessions_error_revoking: () => m.sessions_error_revoking(),

  // ── Personal settings ─────────────────────────────────────────────────────
  username_required: () => m.username_required(),
  username_too_long: () => m.username_too_long(),
  username_invalid: () => m.username_invalid(),
  username_taken: () => m.username_taken(),
  display_name_too_long: () => m.display_name_too_long(),
  bio_too_long: () => m.bio_too_long(),
  profile_update_failed: () => m.profile_update_failed(),
  profile_update_error: () => m.profile_update_error(),
  profile_updated: () => m.profile_updated(),
  validation_error: () => m.validation_error(),

  // ── API tokens ────────────────────────────────────────────────────────────
  api_token_name_required: () => m.api_token_name_required(),
  name_too_long: () => m.name_too_long({ max: 50 }),
  field_required: () => m.field_required(),
  api_token_created: () => m.api_token_created(),
  api_token_renamed: () => m.api_token_renamed(),
  api_token_reset: () => m.api_token_reset(),
  api_token_deleted: () => m.api_token_deleted(),
  expiration_date_must_be_future: () => m.expiration_date_must_be_future(),
  maximum_expiration_one_year: () => m.maximum_expiration_one_year(),
  invalid_expiration_option: () => m.invalid_expiration_option(),
  error_creating_token: () => m.error_creating_token(),
  error_renaming_token: () => m.error_renaming_token(),
  token_id_required: () => m.token_id_required(),
  user_or_tokens_not_found: () => m.user_or_tokens_not_found(),
  token_not_found: () => m.token_not_found(),
  cannot_reset_expired_token: () => m.cannot_reset_expired_token(),
  error_resetting_token: () => m.error_resetting_token(),
  error_deleting_token: () => m.error_deleting_token(),

  // ── Shared ────────────────────────────────────────────────────────────────
  unauthorized: () => m.unauthorized(),
  cancel: () => m.cancel(),
  delete: () => m.delete()
};

/**
 * Resolve a server message key (or raw string) to a localized string.
 * Returns `key` unchanged when it is not a known key.
 */
export const resolveStatusMessage = (key: string | null | undefined): string => {
  if (!key) return '';
  return STATUS_MESSAGES[key]?.() ?? key;
};

/**
 * Extract the message from a form `ActionResult` payload. Prefers an explicit
 * message, then falls back to `error` (a common fail() shape), then to a
 * generic localized fallback.
 */
export const resolveFormMessage = (
  data: Record<string, unknown> | undefined,
  fallback: string
): string => {
  const message = data?.message ?? data?.error;
  if (typeof message === 'string' && message) {
    return resolveStatusMessage(message);
  }
  return fallback;
};

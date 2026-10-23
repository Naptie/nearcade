import { m } from '$lib/paraglide/messages';
import { type OAuthScope } from '$lib/auth/oauth/scopes';

/**
 * Human-readable labels for each OAuth scope, using i18n messages.
 *
 * The map is typed by the catalog, so a scope that joins the catalog without a
 * label is a **compile error** rather than a scope the consent screen renders
 * as its own raw name.
 */
const LABELS: Record<OAuthScope, () => string> = {
  openid: () => m.oauth_scope_openid(),
  profile: () => m.oauth_scope_profile(),
  email: () => m.oauth_scope_email(),
  offline_access: () => m.oauth_scope_offline_access(),
  'read:account': () => m.oauth_scope_read_account(),
  'read:notifications': () => m.oauth_scope_read_notifications(),
  'write:account': () => m.oauth_scope_write_account(),
  'write:notifications': () => m.oauth_scope_write_notifications(),
  'write:posts': () => m.oauth_scope_write_posts(),
  'write:comments': () => m.oauth_scope_write_comments(),
  'write:images': () => m.oauth_scope_write_images(),
  'write:clubs': () => m.oauth_scope_write_clubs(),
  'write:universities': () => m.oauth_scope_write_universities(),
  'write:shops': () => m.oauth_scope_write_shops(),
  'write:attendance': () => m.oauth_scope_write_attendance(),
  'write:reports': () => m.oauth_scope_write_reports(),
  'write:moderation': () => m.oauth_scope_write_moderation()
};

/**
 * FontAwesome icon class for each scope category.
 *
 * Typed by the catalog for the same reason as the labels: a scope without an
 * icon is a compile error, not a generic key on the consent screen.
 */
const ICONS: Record<OAuthScope, string> = {
  openid: 'fa-id-badge',
  profile: 'fa-user',
  email: 'fa-envelope',
  offline_access: 'fa-rotate',
  'read:account': 'fa-user',
  'read:notifications': 'fa-bell',
  'write:account': 'fa-user-pen',
  'write:notifications': 'fa-bell',
  'write:posts': 'fa-file-lines',
  'write:comments': 'fa-comments',
  'write:images': 'fa-image',
  'write:clubs': 'fa-people-group',
  'write:universities': 'fa-graduation-cap',
  'write:shops': 'fa-store',
  'write:attendance': 'fa-location-dot',
  'write:reports': 'fa-chart-simple',
  'write:moderation': 'fa-flag'
};

/**
 * The label of a scope, or the scope itself when it is not one of ours.
 *
 * The lookup tolerates a scope the catalog does not know — a provider may
 * hand out a scope this deployment never declared — but the maps above are
 * exhaustive, so a scope of ours can never be missing one.
 */
export function getScopeLabel(scope: string): string {
  const label = (LABELS as Record<string, (() => string) | undefined>)[scope];
  return label ? label() : scope;
}

/** The icon of a scope, or a generic key when it is not one of ours. */
export function getScopeIcon(scope: string): string {
  return (ICONS as Record<string, string | undefined>)[scope] ?? 'fa-key';
}

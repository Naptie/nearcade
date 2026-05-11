import { m } from '$lib/paraglide/messages';

/**
 * Human-readable labels for each OAuth scope, using i18n messages.
 */
export function getScopeLabel(scope: string): string {
  const labels: Record<string, () => string> = {
    openid: () => m.oauth_scope_openid(),
    profile: () => m.oauth_scope_profile(),
    email: () => m.oauth_scope_email(),
    offline_access: () => m.oauth_scope_offline_access(),
    'read:shops': () => m.oauth_scope_read_shops(),
    'write:shops': () => m.oauth_scope_write_shops(),
    'read:universities': () => m.oauth_scope_read_universities(),
    'write:universities': () => m.oauth_scope_write_universities(),
    'read:clubs': () => m.oauth_scope_read_clubs(),
    'write:clubs': () => m.oauth_scope_write_clubs(),
    'read:posts': () => m.oauth_scope_read_posts(),
    'write:posts': () => m.oauth_scope_write_posts(),
    'read:comments': () => m.oauth_scope_read_comments(),
    'write:comments': () => m.oauth_scope_write_comments(),
    'read:users': () => m.oauth_scope_read_users(),
    'write:users': () => m.oauth_scope_write_users(),
    'read:images': () => m.oauth_scope_read_images(),
    'write:images': () => m.oauth_scope_write_images(),
    'read:notifications': () => m.oauth_scope_read_notifications(),
    'write:notifications': () => m.oauth_scope_write_notifications()
  };
  return labels[scope]?.() ?? scope;
}

/**
 * FontAwesome icon class for each scope category.
 */
export function getScopeIcon(scope: string): string {
  const icons: Record<string, string> = {
    openid: 'fa-id-badge',
    profile: 'fa-user',
    email: 'fa-envelope',
    offline_access: 'fa-rotate',
    'read:shops': 'fa-store',
    'write:shops': 'fa-store',
    'read:universities': 'fa-graduation-cap',
    'write:universities': 'fa-graduation-cap',
    'read:clubs': 'fa-people-group',
    'write:clubs': 'fa-people-group',
    'read:posts': 'fa-file-lines',
    'write:posts': 'fa-file-lines',
    'read:comments': 'fa-comments',
    'write:comments': 'fa-comments',
    'read:users': 'fa-users',
    'write:users': 'fa-users',
    'read:images': 'fa-image',
    'write:images': 'fa-image',
    'read:notifications': 'fa-bell',
    'write:notifications': 'fa-bell'
  };
  return icons[scope] ?? 'fa-key';
}

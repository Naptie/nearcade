/**
 * Localized labels + icons for the precise UGC content types (client-safe).
 * Used by the admin queue (select options, row badges, per-row actions) and
 * by server-side removal notifications. Keep `ugc_type_*` message keys in
 * sync with `UGC_CONTENT_TYPES` in `./types`.
 */
import { m } from '$lib/paraglide/messages';
import type { UgcContentType, UgcKind } from './types';

export const UGC_TYPE_LABELS: Record<UgcContentType, () => string> = {
  shop_name: () => m.ugc_type_shop_name(),
  shop_address: () => m.ugc_type_shop_address(),
  shop_description: () => m.ugc_type_shop_description(),
  game_name: () => m.ugc_type_game_name(),
  game_version: () => m.ugc_type_game_version(),
  game_cost: () => m.ugc_type_game_cost(),
  game_description: () => m.ugc_type_game_description(),
  organization_description: () => m.ugc_type_organization_description(),
  post: () => m.ugc_type_post(),
  comment: () => m.ugc_type_comment(),
  delete_request: () => m.ugc_type_delete_request(),
  attendance_report: () => m.ugc_type_attendance_report(),
  bio: () => m.ugc_type_bio()
};

export const ugcTypeLabel = (type: UgcContentType): string => UGC_TYPE_LABELS[type]();

/** Localized labels for the coarse entity families (fallback noun). */
export const UGC_KIND_LABELS: Record<UgcKind, () => string> = {
  shop: () => m.ugc_kind_shop(),
  organization: () => m.ugc_kind_organization(),
  post: () => m.ugc_kind_post(),
  comment: () => m.ugc_kind_comment(),
  delete_request: () => m.ugc_kind_delete_request(),
  attendance_report: () => m.ugc_kind_attendance_report(),
  user: () => m.ugc_kind_user()
};

export const ugcKindLabel = (kind: UgcKind): string => UGC_KIND_LABELS[kind]();

/**
 * Noun for system removal messages: the precise per-field content type when
 * it was recorded, otherwise the coarse family (legacy notifications).
 */
export const ugcRemovalNoun = (type?: UgcContentType, kind?: UgcKind): string =>
  type ? ugcTypeLabel(type) : kind ? ugcKindLabel(kind) : '';

/** FontAwesome icon per precise content type (admin row badges). */
export const UGC_TYPE_ICONS: Record<UgcContentType, string> = {
  shop_name: 'fa-store',
  shop_address: 'fa-location-dot',
  shop_description: 'fa-align-left',
  game_name: 'fa-gamepad',
  game_version: 'fa-tag',
  game_cost: 'fa-coins',
  game_description: 'fa-align-left',
  organization_description: 'fa-graduation-cap',
  post: 'fa-file-lines',
  comment: 'fa-comment',
  delete_request: 'fa-trash-can',
  attendance_report: 'fa-user-clock',
  bio: 'fa-user-pen'
};

export const AUDIT_STATUSES: { value: string; label: string; color: string }[] = [
  { value: 'all', label: m.all_statuses(), color: '' },
  { value: 'pending', label: m.admin_ugc_status_pending(), color: 'info' },
  { value: 'pass', label: m.admin_ugc_status_pass(), color: 'success' },
  { value: 'review', label: m.admin_ugc_status_review(), color: 'warning' },
  { value: 'block', label: m.admin_ugc_status_block(), color: 'error' },
  { value: 'removed', label: m.admin_ugc_status_removed(), color: 'ghost' }
];

export const auditStatusColor = (status: string): string =>
  AUDIT_STATUSES.find((s) => s.value === status)?.color ?? 'ghost';

export const auditStatusLabel = (status: string): string =>
  AUDIT_STATUSES.find((s) => s.value === status)?.label ?? status;

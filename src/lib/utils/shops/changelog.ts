import type { m as mFunc } from '$lib/paraglide/messages';
import type { ShopChangelogEntry } from '$lib/types';
import { GAME_TITLES } from '$lib/constants';

/**
 * Changelog actions as the app knows them today, plus any string the ledger
 * might contain. Admin facets read action values straight out of MongoDB, where
 * a deployment newer than this bundle can already have recorded actions that
 * are not in the enum — every lookup below falls back to the raw value instead
 * of failing to type-check.
 */
export type KnownShopChangelogAction = ShopChangelogEntry['action'] | (string & {});

export const getShopChangelogActionName = (
  action: KnownShopChangelogAction,
  m: typeof mFunc
): string => {
  const actionMap: Record<string, string> = {
    created: m.shop_changelog_action_created(),
    modified: m.changelog_action_modified(),
    deleted: m.changelog_action_deleted(),
    game_added: m.shop_changelog_action_game_added(),
    game_modified: m.shop_changelog_action_game_modified(),
    game_deleted: m.shop_changelog_action_game_deleted(),
    rollback: m.shop_changelog_action_rollback(),
    photo_uploaded: m.shop_changelog_action_photo_uploaded(),
    photo_deleted: m.shop_changelog_action_photo_deleted(),
    delete_request_submitted: m.shop_changelog_action_delete_request_submitted(),
    delete_request_approved: m.shop_changelog_action_delete_request_approved(),
    delete_request_rejected: m.shop_changelog_action_delete_request_rejected(),
    photo_delete_request_submitted: m.shop_changelog_action_photo_delete_request_submitted(),
    photo_delete_request_approved: m.shop_changelog_action_photo_delete_request_approved(),
    photo_delete_request_rejected: m.shop_changelog_action_photo_delete_request_rejected()
  };
  return actionMap[action] ?? action;
};

export const getShopChangelogFieldName = (field: string, m: typeof mFunc): string => {
  const fieldMap: Record<string, string> = {
    name: m.shop_name(),
    comment: m.shop_description(),
    address: m.shop_address(),
    openingHours: m.shop_opening_hours(),
    location: m.shop_location(),
    isClosed: m.shop_mark_as_closed(),
    closedReason: m.shop_closed_reason(),
    game: m.shop_games(),
    'game.titleId': m.shop_game_title(),
    'game.name': m.shop_game_name(),
    'game.version': m.shop_game_version(),
    'game.comment': m.shop_game_description(),
    'game.quantity': m.shop_game_quantity(),
    'game.cost': m.shop_game_cost(),
    photo: m.shop_photos(),
    delete_request: m.shop_delete_request()
  };
  return fieldMap[field] ?? field;
};

const formatShopChangelogValue = (value: string, field: string, m: typeof mFunc): string => {
  if (!value || value === 'null') return m.not_specified();

  if (field === 'game.titleId') {
    const title = GAME_TITLES.find((game) => game.id.toString() === value);
    if (title) return m[title.key]();
  }

  if (field === 'isClosed') {
    if (value === 'true') return m.yes();
    if (value === 'false') return m.no();
  }

  return value;
};

export const formatShopChangelogDescription = (
  entry: ShopChangelogEntry,
  m: typeof mFunc
): string => {
  const fieldName = getShopChangelogFieldName(entry.fieldInfo.field, m);

  switch (entry.action) {
    case 'game_added':
      return m.shop_changelog_added_game({
        gameName: entry.fieldInfo.gameName ?? '',
        gameVersion: entry.fieldInfo.gameVersion ?? ''
      });
    case 'game_modified':
      if (entry.fieldInfo.field.startsWith('game.')) {
        return m.shop_changelog_updated_game({
          field: fieldName,
          gameName: entry.fieldInfo.gameName ?? '',
          gameVersion: entry.fieldInfo.gameVersion ?? ''
        });
      }
      return m.shop_changelog_modified_game({
        gameName: entry.fieldInfo.gameName ?? '',
        gameVersion: entry.fieldInfo.gameVersion ?? ''
      });
    case 'game_deleted':
      return m.shop_changelog_deleted_game({
        gameName: entry.fieldInfo.gameName ?? '',
        gameVersion: entry.fieldInfo.gameVersion ?? ''
      });
    case 'photo_uploaded':
      return m.shop_changelog_uploaded_photo();
    case 'photo_deleted':
      return m.shop_changelog_deleted_photo();
    case 'rollback':
      return m.shop_changelog_rollback();
    case 'delete_request_submitted':
      return m.shop_changelog_submitted_delete_request();
    case 'delete_request_approved':
      return m.shop_changelog_approved_delete_request();
    case 'delete_request_rejected':
      return m.shop_changelog_rejected_delete_request();
    case 'photo_delete_request_submitted':
      return m.shop_changelog_submitted_photo_delete_request();
    case 'photo_delete_request_approved':
      return m.shop_changelog_approved_photo_delete_request();
    case 'photo_delete_request_rejected':
      return m.shop_changelog_rejected_photo_delete_request();
    case 'modified': {
      const oldLen = entry.oldValue?.length ?? 0;
      const newLen = entry.newValue?.length ?? 0;
      if (oldLen < 30 && newLen < 30) {
        if (entry.oldValue && entry.newValue) {
          return m.changelog_changed_from_to({
            field: fieldName,
            oldValue: formatShopChangelogValue(entry.oldValue, entry.fieldInfo.field, m),
            newValue: formatShopChangelogValue(entry.newValue, entry.fieldInfo.field, m)
          });
        }
        if (entry.newValue && !entry.oldValue) {
          return m.changelog_set_to({
            field: fieldName,
            newValue: formatShopChangelogValue(entry.newValue, entry.fieldInfo.field, m)
          });
        }
        if (entry.oldValue && !entry.newValue) {
          return m.changelog_cleared({ field: fieldName });
        }
      }
      return m.changelog_modified({ field: fieldName });
    }
    case 'created':
      return m.shop_changelog_action_created();
    case 'deleted':
      return m.changelog_action_deleted();
    default:
      return String(entry.action);
  }
};

export const getShopChangelogActionBadgeClass = (action: KnownShopChangelogAction): string => {
  switch (action) {
    case 'created':
    case 'game_added':
    case 'photo_uploaded':
    case 'delete_request_submitted':
    case 'photo_delete_request_submitted':
      return 'badge-success';
    case 'modified':
    case 'game_modified':
      return 'badge-info';
    case 'rollback':
      return 'badge-primary';
    case 'delete_request_approved':
    case 'photo_delete_request_approved':
      return 'badge-warning';
    case 'deleted':
    case 'game_deleted':
    case 'photo_deleted':
    case 'delete_request_rejected':
    case 'photo_delete_request_rejected':
      return 'badge-error';
    default:
      return 'badge-ghost';
  }
};

export const getShopChangelogActionIcon = (action: KnownShopChangelogAction): string => {
  switch (action) {
    case 'created':
      return 'fa-plus text-success';
    case 'modified':
      return 'fa-edit text-info';
    case 'deleted':
      return 'fa-trash text-error';
    case 'game_added':
      return 'fa-gamepad text-success';
    case 'game_modified':
      return 'fa-gamepad text-info';
    case 'game_deleted':
      return 'fa-gamepad text-error';
    case 'rollback':
      return 'fa-rotate-left text-primary';
    case 'photo_uploaded':
      return 'fa-image text-success';
    case 'photo_deleted':
      return 'fa-image text-error';
    case 'delete_request_submitted':
    case 'photo_delete_request_submitted':
      return 'fa-flag text-warning';
    case 'delete_request_approved':
    case 'photo_delete_request_approved':
      return 'fa-circle-check text-warning';
    case 'delete_request_rejected':
    case 'photo_delete_request_rejected':
      return 'fa-circle-xmark text-error';
    default:
      return 'fa-edit text-base-content';
  }
};

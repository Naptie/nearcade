import { UGC_TYPES_BY_KIND, type UgcContentType, type UgcKind } from './types';

export const MAX_AUDITED_TEXT_LENGTH = 8000;
export const MAX_RAW_TEXT_LENGTH = 20000;

export interface UgcOccurrenceSpec {
  type: UgcContentType;
  key?: string;
}

export const ugcEntryId = (type: UgcContentType, refId: string | number, key?: string): string =>
  key ? `${type}:${String(refId)}:${key}` : `${type}:${String(refId)}`;

const SHOP_TOP_LEVEL_TYPES = new Set<UgcContentType>([
  'shop_name',
  'shop_description',
  'shop_address'
]);

export const resolveUgcOccurrence = (kind: UgcKind, fieldKey: string): UgcOccurrenceSpec | null => {
  switch (kind) {
    case 'shop': {
      if (SHOP_TOP_LEVEL_TYPES.has(fieldKey as UgcContentType)) {
        return { type: fieldKey as UgcContentType };
      }
      const game = /^game_(name|version|cost|description)(?::(.+))?$/.exec(fieldKey);
      if (game?.[2]) return { type: `game_${game[1]}` as UgcContentType, key: game[2] };
      return null;
    }
    case 'organization':
      return { type: 'organization_description' };
    case 'comment':
      return { type: 'comment' };
    case 'post':
      return fieldKey === 'title' || fieldKey === 'content'
        ? { type: 'post', key: fieldKey }
        : null;
    case 'delete_request':
      return { type: 'delete_request' };
    case 'attendance_report':
      return { type: 'attendance_report' };
    case 'user':
      if (fieldKey === 'bio') return { type: 'bio' };
      if (fieldKey === 'name' || fieldKey === 'user_name') return { type: 'user_name' };
      if (fieldKey === 'displayName' || fieldKey === 'user_display_name') {
        return { type: 'user_display_name' };
      }
      return null;
    default:
      return null;
  }
};

export const ugcOccurrenceFilter = (kind: UgcKind, refIds: Array<string | number>) => ({
  type: { $in: [...UGC_TYPES_BY_KIND[kind]] },
  refId: { $in: [...new Set(refIds.map(String))] }
});

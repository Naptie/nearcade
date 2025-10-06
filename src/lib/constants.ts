// Game constants for arcade machine types
export const GAMES = [
  { id: 1, key: 'maimai_dx' },
  { id: 3, key: 'chunithm' },
  { id: 31, key: 'taiko_no_tatsujin' },
  { id: 4, key: 'sound_voltex' },
  { id: 17, key: 'wacca' }
] as const;

export const USER_TYPES = [
  'site_admin',
  'school_admin',
  'club_admin',
  'school_moderator',
  'club_moderator',
  'student',
  'regular'
] as const;

export const SOCIAL_PLATFORMS = ['qq', 'wechat', 'github', 'discord', 'divingfish'] as const;

// Radius constants for search distances
export const RADIUS_OPTIONS = [1, 2, 5, 10] as const;

// Pagination constants
export const PAGINATION = {
  PAGE_SIZE: 48,
  SCROLL_THRESHOLD: 300 // pixels from bottom to trigger load more
} as const;

// Sort criteria constants
export const SORT_CRITERIA = [
  { key: 'shops' },
  { key: 'machines' },
  { key: 'density' },
  ...GAMES.map((game) => ({
    key: game.key
  }))
] as const;

export const ROUTE_CACHE_STORE = 'route-cache';
export const ROUTE_CACHE_EXPIRY_HOURS = 24;

export const HOVERED_SHOP_INDEX = 40002;
export const SELECTED_SHOP_INDEX = 40001;
export const ORIGIN_INDEX = 40000;
export const SHOP_INDEX = 30000;

// Attendance proximity check radius in kilometers
export const ATTENDANCE_RADIUS_KM = 0.5;
export const HOVERED_ROUTE_INDEX = 29999;
export const SELECTED_ROUTE_INDEX = 20000;
export const ROUTE_INDEX = 10000;

export enum ShopSource {
  BEMANICN = 'bemanicn',
  ZIV = 'ziv'
}

export type GameKey = (typeof GAMES)[number]['key'];
export type SortKey = (typeof SORT_CRITERIA)[number]['key'];
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

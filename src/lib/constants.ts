// Game constants for arcade machine types
export const GAME_TITLES = [
  { id: 1, key: 'maimai_dx', seats: 2 },
  { id: 2, key: 'maimai', seats: 2 },
  { id: 3, key: 'chunithm', seats: 1 },
  { id: 4, key: 'sound_voltex', seats: 1 },
  { id: 5, key: 'beatmania_iidx', seats: 2 },
  { id: 6, key: 'jubeat', seats: 1 },
  { id: 7, key: 'nostalgia', seats: 1 },
  { id: 8, key: 'gd_guitarfreaks', seats: 2 },
  { id: 9, key: 'gd_drummania', seats: 1 },
  { id: 10, key: 'dancerush', seats: 2 },
  { id: 11, key: 'dance_dance_revolution', seats: 2 },
  { id: 12, key: 'popn_music', seats: 1 },
  { id: 13, key: 'danceevolution', seats: 2 },
  { id: 14, key: 'reflec_beat', seats: 2 },
  { id: 15, key: 'taiko_no_tatsujin_old', seats: 2 },
  { id: 16, key: 'groove_coaster', seats: 1 },
  { id: 17, key: 'wacca', seats: 1 },
  { id: 19, key: 'pump_it_up', seats: 2 },
  { id: 20, key: 'top_star', seats: 1 },
  { id: 21, key: 'djmax_technika', seats: 1 },
  { id: 22, key: 'percussion_master', seats: 2 },
  { id: 23, key: 'danzbase', seats: 2 },
  { id: 24, key: 'project_diva_arcade', seats: 1 },
  { id: 27, key: 'ongeki', seats: 1 },
  { id: 29, key: 'dance_around', seats: 2 },
  { id: 31, key: 'taiko_no_tatsujin', seats: 2 },
  { id: 33, key: 'dance3_evo', seats: 2 },
  { id: 34, key: 'jubeat_cn', seats: 1 }
] as const;

export const USER_TYPES = [
  'site_admin',
  'developer',
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
  ...GAME_TITLES.map((game) => ({
    key: game.key
  }))
] as const;

export const ROUTE_CACHE_STORE = 'route-cache';
export const ROUTE_CACHE_EXPIRY_HOURS = 24;
export const APP_NAME = 'nearcade';
export const IMAGE_STORAGE_PREFIX = APP_NAME;

export const HOVERED_SHOP_INDEX = 40002;
export const SELECTED_SHOP_INDEX = 40001;
export const ORIGIN_INDEX = 40000;
export const SHOP_INDEX = 30000;

// Attendance proximity check radius in kilometers
export const ATTENDANCE_RADIUS_KM = 2;
export const HOVERED_ROUTE_INDEX = 29999;
export const SELECTED_ROUTE_INDEX = 20000;
export const ROUTE_INDEX = 10000;

export const SHOP_ID_OFFSET_BEMANICN = 10000;
export const SHOP_ID_OFFSET_ZIV = 20000;

export type GameKey = (typeof GAME_TITLES)[number]['key'];
export type SortKey = (typeof SORT_CRITERIA)[number]['key'];
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

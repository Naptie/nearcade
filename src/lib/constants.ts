// Game constants for arcade machine types
export const GAMES = [
  { id: 1, key: 'maimai_dx' },
  { id: 3, key: 'chunithm' },
  { id: 31, key: 'taiko_no_tatsujin' },
  { id: 4, key: 'sound_voltex' },
  { id: 17, key: 'wacca' }
] as const;

// Radius constants for search distances
export const RADIUS_OPTIONS = [5, 10, 20, 30] as const;

// Pagination constants
export const PAGINATION = {
  PAGE_SIZE: 20,
  SCROLL_THRESHOLD: 200 // pixels from bottom to trigger load more
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

export type GameKey = (typeof GAMES)[number]['key'];
export type SortKey = (typeof SORT_CRITERIA)[number]['key'];

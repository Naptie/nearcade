import { m } from '$lib/paraglide/messages';

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

export interface SocialLinkRef {
  username: string;
  userId?: string;
}

export const OAUTH_PROVIDERS = [
  {
    id: 'qq',
    name: 'QQ',
    icon: 'fa-qq',
    login: true,
    bind: true,
    profile: ({ username }: SocialLinkRef) => `https://user.qzone.qq.com/${username}`
  },
  {
    id: 'wechat',
    name: m.social_platform_wechat(),
    icon: 'fa-weixin',
    class: 'hover:bg-[#07C160] hover:text-white',
    login: false,
    bind: false,
    profile: true
  },
  {
    id: 'microsoft-entra-id',
    name: 'Microsoft',
    icon: 'fa-microsoft',
    login: true,
    bind: true,
    profile: false
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: 'fa-github',
    login: true,
    bind: true,
    profile: ({ username }: SocialLinkRef) => `https://github.com/${username}`
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: 'fa-discord',
    class: 'hover:bg-[#5865F2] hover:text-white',
    login: true,
    bind: true,
    profile: true
  },
  {
    id: 'osu',
    name: 'osu!',
    icon: 'osu.svg',
    class: 'hover:bg-[#DA5892] hover:text-white',
    login: true,
    bind: true,
    profile: ({ username, userId }: SocialLinkRef) =>
      `https://osu.ppy.sh/users/${userId ?? username}`
  },
  {
    id: 'diving-fish',
    name: m.social_platform_divingfish(),
    icon: 'diving-fish.ico',
    class: 'hover:bg-[#0FA3A3] hover:text-white',
    login: true,
    bind: true,
    profile: true
  },
  {
    id: 'phira',
    name: 'Phira',
    icon: 'phira.webp',
    class:
      'bg-linear-to-r from-transparent to-transparent hover:from-[#68C3C9] hover:to-[#3C80F6] hover:text-black',
    login: true,
    bind: true,
    profile: ({ userId }: SocialLinkRef) => (userId ? `https://phira.moe/user/${userId}` : null)
  }
] as const;

// Radius constants for search distances
export const RADIUS_OPTIONS = [1, 2, 5, 10, 20, 30] as const;

export const RANKING_FIXED_GAMES: readonly GameKey[] = [
  'maimai_dx',
  'chunithm',
  'taiko_no_tatsujin',
  'jubeat_cn'
];

// Radius constants for rankings
export const RANKING_RADIUS_OPTIONS = [2, 5, 10, 30] as const;

/**
 * Radius options for metro station rankings. The largest option equals the
 * shop↔station snapping cutoff (METRO_ACCESS_MAX_KM), so the widest bucket's
 * shop/machine counts are exactly the persisted `transit.metro` assignments —
 * no extra shop enumeration is needed for the ranking. All values are in km.
 */
export const METRO_RANKING_RADIUS_OPTIONS = [0.2, 0.5, 1, 2] as const;

/**
 * Dot-safe rank key for a (sort criterion, radius) pair. Mongo query paths
 * treat `.` as a nested-field separator, so decimal radii (0.2, 0.5) must
 * never appear literally in `rankOrder` keys — they are encoded in
 * centimetres (`0.2` → `20`, `2` → `200`), which stays integer and unique.
 */
export const metroRankingSortKey = (sortBy: string, radiusKm: number): string =>
  `${sortBy}_${Math.round(radiusKm * 100)}`;

// Limit constants for count-based search
export const LIMIT_OPTIONS = [5, 10, 20, 50, 100, 150] as const;

// Hard limit when both radius and limit are unlimited
export const MAX_DISCOVER_RESULTS = 150;

/**
 * localStorage key for the discover table's time-first vs distance-first
 * preference. Kept here so the default and the key live together.
 */
export const DISCOVER_TIME_PRIMARY_KEY = 'nearcade:discover-time-primary';

// ── Metro (openmetro) ────────────────────────────────────────────────────────
/**
 * Walking pace for every walk-time estimate. Preferred walking speed is
 * 1.10–1.65 m/s (4.0–5.9 km/h); urban design guides use 4.8–5.0 km/h
 * (Design Manual for Roads and Bridges; TfL PTAL). 4.5 km/h sits inside the
 * evidence range and leans slightly conservative — people walk to take metro.
 */
export const METRO_WALK_SPEED_KMH = 4.5;
/**
 * Utility-cycling pace (shared bikes and scooters in city traffic). Average
 * cycling speed in Copenhagen is 15.5 km/h; ~100 W on an upright roadster
 * gives ~20 km/h, which is not representative of a casual city trip.
 *
 * Reference only: it justifies the ~5 km scale at which a ride becomes the
 * natural choice, and is never multiplied out into a per-shop result (a
 * straight-line distance cannot support a credible door-to-door time).
 */
export const METRO_RIDE_SPEED_KMH = 15.0;
/** Straight-line → street-network detour. Walking is the most indirect. */
export const METRO_WALK_DETOUR_FACTOR = 1.3;
// shop↔station assignment cutoff
export const METRO_ACCESS_MAX_KM = 2.0;
// origin→station cutoff, else metro is unavailable for the request
export const METRO_ORIGIN_MAX_KM = 3.0;
// security check + platform wait when entering the system
export const METRO_ENTRY_OVERHEAD_SECONDS = 240;
// exit gates + wayfinding
export const METRO_EXIT_OVERHEAD_SECONDS = 120;

/**
 * Metro substitution: how far you can walk in the time the metro ride itself
 * takes. A shop is metro-worthy when riding beats walking it straight-line by
 * any margin — straight-line distance overstates the walk (buildings, rivers,
 * one-way streets), so the comparison stays on the conservative side.
 *
 * Minimum number of distinct stations the ride must pass through. Entering and
 * leaving at the same station is a walk with extra steps, not a metro trip.
 */
export const METRO_MIN_RIDE_STATIONS = 2;

/**
 * The search radius *is* the travel-time input: each distance option carries a
 * door-to-door time budget, so the UI labels "5 km · 45min" and every result is
 * filtered by that budget without a second control.
 *
 * These are willingness-to-travel budgets anchored to realistic times: ~2 km is
 * a comfortable walk, ~5 km a short ride, ~20 km+ a metro trip. The walk/ride
 * speeds above describe the same scales but are not multiplied out here — the
 * riding band's 20 min would undercut the walking band's 35 min and make the
 * options contradict each other.
 *
 * **Invariant: `minutes` must strictly increase with `km`.** A larger radius
 * must never imply a shorter trip — otherwise the options contradict each other
 * and a wider search could return fewer shops than a narrower one.
 */
export const DISCOVER_RADIUS_BUDGETS = [
  { km: 1, minutes: 15 },
  { km: 2, minutes: 30 },
  { km: 5, minutes: 45 },
  { km: 10, minutes: 60 },
  { km: 20, minutes: 90 },
  { km: 30, minutes: 120 }
] as const;

export type DiscoverRadiusBudget = (typeof DISCOVER_RADIUS_BUDGETS)[number];

/** Time budget (minutes) implied by a radius; null for unlimited (radius 0). */
export const getTravelBudgetMinutes = (radiusKm: number): number | null =>
  getTravelBudget(radiusKm)?.minutes ?? null;

/** The full budget entry for a radius. Null for unlimited (radius 0). */
export const getTravelBudget = (radiusKm: number): DiscoverRadiusBudget | null =>
  DISCOVER_RADIUS_BUDGETS.find((entry) => entry.km === radiusKm) ?? null;

// Pagination constants
export const PAGINATION = {
  PAGE_SIZE: 48,
  RANKING_PAGE_SIZE: 24,
  SCROLL_THRESHOLD: 300 // pixels from bottom to trigger load more
} as const;

// Sort criteria constants
export const SORT_CRITERIA = [
  { key: 'shops' },
  { key: 'machines' },
  { key: 'density' },
  { key: 'per_capita' },
  ...GAME_TITLES.map((game) => ({
    key: game.key
  }))
] as const;

export const REGION_LEVELS = [
  { key: 'country', label: 'country' },
  { key: 'province', label: 'province' },
  { key: 'city', label: 'city' },
  { key: 'county', label: 'county' }
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

export const QR_SESSION_TTL = 120;

export const SHOP_ID_OFFSET_BEMANICN = 10000;
export const SHOP_ID_OFFSET_ZIV = 20000;

export type GameKey = (typeof GAME_TITLES)[number]['key'];
export type SortKey = (typeof SORT_CRITERIA)[number]['key'];

/**
 * Sort options for metro station rankings: no area/population-based criteria
 * (density, per-capita), so it is SORT_CRITERIA minus those two entries.
 * Passed to RankingsHeader via its `criteria` prop.
 */
export const METRO_SORT_CRITERIA = SORT_CRITERIA.filter(
  (criteria) => criteria.key !== 'density' && criteria.key !== 'per_capita'
) as readonly { key: SortKey }[];
export type SocialPlatform = Exclude<(typeof OAUTH_PROVIDERS)[number]['id'], 'microsoft-entra-id'>;

export const SOCIAL_PLATFORMS = OAUTH_PROVIDERS.filter((provider) => provider.profile).map(
  (provider) => provider.id
) as readonly SocialPlatform[];

/**
 * Recursively strips dashes from a string literal type so a hyphenated
 * platform id like `diving-fish` maps to the `divingfish` identifier used in
 * i18n message keys.
 */
export type RemoveDashes<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Head}${RemoveDashes<Tail>}`
  : S;

/**
 * The i18n message-key suffix for a platform. Paraglide turns message ids into
 * JS identifiers, so dashes are not allowed — the generic rule is to simply
 * drop them (e.g. `diving-fish` → `divingfish`).
 */
export type SocialPlatformMessageKey = RemoveDashes<SocialPlatform>;

export function socialPlatformMessageKey<S extends SocialPlatform>(platform: S): RemoveDashes<S> {
  return platform.replaceAll('-', '') as RemoveDashes<S>;
}

/**
 * Temporary kill switch for the UGC translation pipeline.
 *
 * When `false` (current state):
 *  - the write-time pipeline never enqueues translation jobs,
 *  - the on-demand reader backfill rejects every request,
 *  - the API endpoint serves the cache but never enqueues on a miss,
 *  - the client never fetches/requests translations (original text only),
 *  - the job loop still *drains and completes* whatever jobs are already
 *    sitting in Redis, so nothing rots while the feature is off.
 *
 * Translation infrastructure (cache, queues, SSE, admin UI) is fully
 * preserved — flip this to `true` to re-enable the whole pipeline.
 */
export const UGC_TRANSLATION_ENABLED = false;

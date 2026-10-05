/**
 * Single source of truth for shop fields derived from user-entered data.
 *
 * Everything in this module is pure (no env, no DB, no paraglide) so it can be
 * imported by the SvelteKit server, client components, and one-shot scripts
 * alike. The computed fields are persisted alongside the shop document by the
 * write paths (`syncShopDocument`) and backfilled by the one-shot migration
 * script; display, filtering, and the globe all read the same values produced
 * here.
 *
 * WHY THIS IS ITS OWN MODULE — it is the only shop module that is neither a
 * query nor a wire format. The write path computes these fields once and stores
 * them; the read path, the filter engine, the Meilisearch indexer and the
 * migration script all consume them, from both client and server. Folding it
 * into either neighbouring module would make one of those two sides import a
 * module it cannot use (`filter-query.server.ts` is server-only) or would put
 * coordinate→timezone lookups on every client that reads a shop.
 *
 * Opening-hours model: intervals are stored canonically as
 * `{ hour, minute }` pairs where the OPEN side is always the same day
 * (hour ≤ 23) and the CLOSE side may run into the next day (hour ≤ 47,
 * e.g. `25:30` = 01:30 next day). Legacy wraparound entries
 * (`22:00 → 02:00`) are canonicalized to `22:00 → 26:00` by
 * {@link canonicalizeOpeningHours}; existing documents were rewritten once by
 * `scripts/migrate-shop-derived.ts`, and the same function is applied
 * defensively here so documents restored from old changelog snapshots via
 * rollback stay correct.
 */
import tzlookup from '@photostructure/tz-lookup';
import { getTimezoneOffset } from 'date-fns-tz';

import type { Location, OpeningHourTime, Shop } from '$lib/types';

export const MINUTES_PER_DAY = 24 * 60;
/** Latest same-day open hour. */
export const MAX_OPEN_HOUR = 23;
/** Latest close hour; `hour > 23` denotes the next day (`25:30` = 01:30). */
export const MAX_CLOSE_HOUR = 47;
/** Upper bound for the enumerated quantity tokens per title (`t{id}q{n}`). */
export const GAME_TOKEN_QUANTITY_CAP = 64;

export type OpeningHourEntry = [OpeningHourTime, OpeningHourTime];
export type ShopOpeningMinutes = Array<Array<{ o: number; c: number }>>;

/**
 * Resolve the IANA timezone name for a shop location.
 * `Asia/Urumqi` is coerced to `Asia/Shanghai` (national convention).
 *
 * This is a WRITE-time concern: the result is persisted on the document by
 * `computeShopDerivedFields` on every write path, so reads never pay for a
 * coordinate lookup. See `scripts/migrate-shop-derived.ts` for the one-shot
 * backfill of documents written before that switch.
 */
export const resolveShopTimezoneName = (location: Location): string => {
  const [longitude, latitude] = location.coordinates;

  let resolvedTimezone = 'Asia/Shanghai';

  try {
    const timezone = tzlookup(latitude, longitude);
    if (timezone === 'Asia/Urumqi') {
      resolvedTimezone = 'Asia/Shanghai';
    } else if (timezone) {
      resolvedTimezone = timezone;
    }
  } catch (error) {
    console.error('Failed to lookup timezone:', error);
  }

  return resolvedTimezone;
};

/**
 * The shop's timezone name, read from the persisted document.
 *
 * Falls back to a coordinate lookup for documents written before the timezone
 * started being persisted. That is a read-time safety net for an unbackfilled
 * database — once `scripts/migrate-shop-derived.ts` has run, the persisted
 * value is authoritative and this branch is unreachable. It exists because the
 * migration cannot run at application start, and an unbackfilled document would
 * otherwise have no timezone at all.
 */
export const getShopTimezoneName = (
  shop: Pick<Shop, 'location'> & { timezone?: { name?: string } }
): string => shop.timezone?.name || resolveShopTimezoneName(shop.location);

const toMinutes = (time: OpeningHourTime) => time.hour * 60 + time.minute;

const clampTime = (time: OpeningHourTime, maxHour: number): OpeningHourTime => ({
  hour: Math.max(0, Math.min(maxHour, Math.floor(Number(time.hour) || 0))),
  minute: Math.max(0, Math.min(59, Math.floor(Number(time.minute) || 0)))
});

/**
 * Canonicalize a pair of opening-hour times: the open side is folded back
 * into the same day (hour mod 24) and a close side at or before the open side
 * is lifted into the next day (`22:00–02:00` → `22:00–26:00`,
 * `10:00–10:00` → `10:00–34:00`, i.e. 24 hours).
 */
export const canonicalizeOpeningHourPair = (
  open: OpeningHourTime,
  close: OpeningHourTime
): OpeningHourEntry => {
  // An open side beyond 23:00 folds back into the same day (25:00 == 01:00);
  // fold BEFORE clamping so 25:30 never truncates to 23:30.
  const openFolded: OpeningHourTime = {
    hour: Math.max(0, Math.floor(Number(open.hour) || 0)) % 24,
    minute: Math.max(0, Math.min(59, Math.floor(Number(open.minute) || 0)))
  };
  const closeClamped = clampTime(close, MAX_CLOSE_HOUR);
  if (toMinutes(closeClamped) <= toMinutes(openFolded)) {
    return [openFolded, { hour: closeClamped.hour + 24, minute: closeClamped.minute }];
  }
  return [openFolded, closeClamped];
};

/**
 * Canonicalize a full opening-hours array (1 entry = whole week, 7 entries =
 * per weekday). Idempotent; safe to run on legacy wraparound data.
 */
export const canonicalizeOpeningHours = (openingHours: OpeningHourEntry[]): OpeningHourEntry[] =>
  openingHours.map(([open, close]) => canonicalizeOpeningHourPair(open, close));

/**
 * Per-weekday intervals in minutes (`o`/`c`), always 7 entries.
 *
 * Weekday convention — one standard across the whole app: values are
 * MONDAY-FIRST (`0 = Monday … 6 = Sunday`), matching the `openingHours`
 * rows authored via the edit form and the shop-detail page. The only
 * Sunday-first thing in the stack is JS `Date` itself; convert at that
 * single boundary with {@link weekdayFromDate}, never inline.
 */
export const computeOpeningMinutes = (openingHours: OpeningHourEntry[]): ShopOpeningMinutes => {
  const canonical = canonicalizeOpeningHours(openingHours);
  const wholeWeek = canonical.length === 1;
  return Array.from({ length: 7 }, (_, weekday) => {
    const entry = wholeWeek ? canonical[0] : (canonical[weekday] ?? canonical[0]);
    if (!entry) return [];
    return [{ o: toMinutes(entry[0]), c: toMinutes(entry[1]) }];
  });
};

/** `Date.getUTCDay()` (0 = Sunday) → app convention (0 = Monday). */
export const weekdayFromDate = (date: Date): number => (date.getUTCDay() + 6) % 7;

/**
 * Whether the shop is open at `minute` of weekday `day` (both in shop-local
 * time; `day` is Monday-first, 0 = Monday … 6 = Sunday).
 * `minute` may be extended (`1500` = 25:00) to address the late-night
 * portion of that weekday. Intervals from the previous weekday that run past
 * midnight cover the early-morning minutes of `day`.
 */
export const isOpenAtMinutes = (
  openingMinutes: ShopOpeningMinutes,
  day: number,
  minute: number
): boolean => {
  const weekday = ((day % 7) + 7) % 7;
  const covered = (interval: { o: number; c: number }) =>
    interval.o <= minute && minute < interval.c;
  if ((openingMinutes[weekday] ?? []).some(covered)) return true;
  if (minute >= MINUTES_PER_DAY) return false;
  const previous = (weekday + 6) % 7;
  return (openingMinutes[previous] ?? []).some(
    (interval) => interval.c > MINUTES_PER_DAY && minute + MINUTES_PER_DAY < interval.c
  );
};

/**
 * Whether the shop closes at or after `minute` of weekday `day` (shop-local;
 * `day` is Monday-first; `minute` may be extended, e.g. `1500` = "still open
 * at 25:00"). A previous-day interval that spills past midnight counts via
 * its same-day close portion.
 */
export const closesFromMinutes = (
  openingMinutes: ShopOpeningMinutes,
  day: number,
  minute: number
): boolean => {
  const weekday = ((day % 7) + 7) % 7;
  if ((openingMinutes[weekday] ?? []).some((interval) => interval.c >= minute)) return true;
  if (minute >= MINUTES_PER_DAY) return false;
  const previous = (weekday + 6) % 7;
  return (openingMinutes[previous] ?? []).some(
    (interval) => interval.c > MINUTES_PER_DAY && interval.c - MINUTES_PER_DAY >= minute
  );
};

/**
 * Whether the shop opens at or before `minute` of weekday `day` (shop-local;
 * `day` is Monday-first).
 */
export const opensByMinutes = (
  openingMinutes: ShopOpeningMinutes,
  day: number,
  minute: number
): boolean => (openingMinutes[((day % 7) + 7) % 7] ?? []).some((interval) => interval.o <= minute);

/**
 * Exact shop-local weekday (Monday-first) and minute for a point in time,
 * evaluated against the shop's timezone. No tolerance is applied —
 * tolerances belong to attendance/density computations only, never to
 * open/closed state.
 *
 * The offset is deliberately NOT memoized. A zone's UTC offset is a function of
 * *when* you ask, not of the zone alone: `America/New_York` is UTC-5 in January
 * and UTC-4 in July. A cache keyed by zone name freezes whatever the first
 * caller saw for the lifetime of the process, so a server booted in winter
 * would apply the winter offset all summer — a one-hour error in open/closed
 * state for every DST zone. Resolving costs ~14µs, which is noise beside the
 * per-shop work surrounding it.
 */
export const getShopLocalDayMinute = (
  timezoneName: string,
  now: Date = new Date()
): { weekday: number; minute: number; timezoneName: string } => {
  const offsetMs = getTimezoneOffset(timezoneName, now) ?? 0;
  const shifted = new Date(now.getTime() + offsetMs);
  return {
    weekday: weekdayFromDate(shifted),
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    timezoneName
  };
};

/**
 * Exact open/closed state at `now`. Falls back to computing
 * `openingMinutes` on the fly for documents whose persisted cache is missing.
 */
export const isShopOpenAt = (
  shop: Pick<Shop, 'location' | 'openingHours' | 'timezone'> & {
    openingMinutes?: ShopOpeningMinutes;
  } & {
    isClosed?: boolean;
  },
  now: Date = new Date()
): boolean => {
  if (shop.isClosed) return false;
  if (!shop.openingHours || shop.openingHours.length === 0) return false;
  const openingMinutes = shop.openingMinutes ?? computeOpeningMinutes(shop.openingHours);
  const { weekday, minute } = getShopLocalDayMinute(getShopTimezoneName(shop), now);
  return isOpenAtMinutes(openingMinutes, weekday, minute);
};

/**
 * Aggregate machine quantities per titleId, preserving first-seen order.
 * Multiple entries of the same title sum up (two maimai entries of qty 1
 * count as 2 machines).
 */
export const aggregateGameQuantities = <T extends { titleId: number; quantity: number }>(
  games: T[]
): Array<{ titleId: number; quantity: number }> => {
  const totals = new Map<number, number>();
  for (const game of games) {
    totals.set(game.titleId, (totals.get(game.titleId) ?? 0) + game.quantity);
  }
  return Array.from(totals, ([titleId, quantity]) => ({ titleId, quantity }));
};

/**
 * Meilisearch per-entry tokens making compound game leaves exact.
 * Meili evaluates `AND` across array fields per document (any element may
 * satisfy each side), so `games.titleId = 1 AND games.quantity >= 2` could
 * match a maimai unit and an unrelated 3-cabinet game. One token per
 * (title, quantity ≤ n) pair restores per-entry semantics via a single
 * `gameTokens IN [...]` condition.
 */
export const computeGameTokens = (
  aggGames: Array<{ titleId: number; quantity: number }>
): string[] => {
  const tokens: string[] = [];
  for (const { titleId, quantity } of aggGames) {
    tokens.push(`t${titleId}`);
    const capped = Math.max(0, Math.min(quantity, GAME_TOKEN_QUANTITY_CAP));
    for (let n = 0; n <= capped; n++) {
      tokens.push(`t${titleId}q${n}`);
    }
  }
  return tokens;
};

export interface ShopStats {
  /** Σ quantity across all game entries. */
  machineCount: number;
  /** Number of distinct titleIds. */
  distinctTitleCount: number;
  /** Weekdays with at least one opening interval. */
  openDays: number;
  /** Σ(close − open) across the week, in minutes. */
  weeklyOpenMinutes: number;
}

export const computeShopStats = (
  games: Array<{ titleId?: number; quantity: number }>,
  openingMinutes: ShopOpeningMinutes
): ShopStats => ({
  machineCount: games.reduce((total, game) => total + (Number(game.quantity) || 0), 0),
  distinctTitleCount: new Set(games.map((game) => game.titleId)).size,
  openDays: openingMinutes.filter((intervals) => intervals.length > 0).length,
  weeklyOpenMinutes: openingMinutes.reduce(
    (total, intervals) =>
      total + intervals.reduce((sum, interval) => sum + Math.max(0, interval.c - interval.o), 0),
    0
  )
});

/**
 * Every derived, persisted-on-write field for a shop document.
 *
 * The timezone is resolved from the coordinates here rather than at read time,
 * so a coordinate change on any write path re-resolves it automatically and no
 * request ever pays for a timezone lookup.
 */
export const computeShopDerivedFields = (
  shop: Pick<Shop, 'games' | 'openingHours' | 'location'>
): {
  timezone: { name: string };
  openingMinutes: ShopOpeningMinutes;
  aggGames: Array<{ titleId: number; quantity: number }>;
  gameTokens: string[];
  stats: ShopStats;
} => {
  const openingMinutes = computeOpeningMinutes(shop.openingHours ?? []);
  const aggGames = aggregateGameQuantities(shop.games ?? []);
  return {
    timezone: { name: resolveShopTimezoneName(shop.location) },
    openingMinutes,
    aggGames,
    gameTokens: computeGameTokens(aggGames),
    stats: computeShopStats(shop.games ?? [], openingMinutes)
  };
};

type ShopDerivedFields = ReturnType<typeof computeShopDerivedFields>;

/**
 * The persistence-ready shape of {@link ShopDerivedFields}.
 *
 * `stats` is replaced wholesale by every Mongo `$set` and every Meilisearch
 * snapshot, but one of its keys is not derivable from the document:
 * `currentAttendance` is the live-attendance cache that only the attendance
 * endpoints maintain (from Redis, the source of truth). It must be carried
 * over from the existing document on every unrelated write, or an edit would
 * silently zero the shop's attendance sort. Absent stays absent — a shop that
 * never had the cache gains it at its first attendance event.
 */
export const withLiveAttendance = (
  derived: ShopDerivedFields,
  existing?: { stats?: { currentAttendance?: number } } | null
): Omit<ShopDerivedFields, 'stats'> & {
  stats: ShopStats & { currentAttendance?: number };
} => ({
  ...derived,
  stats:
    existing?.stats?.currentAttendance === undefined
      ? derived.stats
      : { ...derived.stats, currentAttendance: existing.stats.currentAttendance }
});

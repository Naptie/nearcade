#!/usr/bin/env tsx
/**
 * Offline regressions for the shop filter engine (opening-hours model,
 * game-expression translation, URL serialization). All mocked — no database,
 * no Meilisearch, no env.
 *
 * Run: pnpm test:filter
 */
import assert from 'node:assert/strict';

import {
  canonicalizeOpeningHourPair,
  canonicalizeOpeningHours,
  computeOpeningMinutes,
  computeGameTokens,
  aggregateGameQuantities,
  isOpenAtMinutes,
  closesFromMinutes,
  opensByMinutes,
  isShopOpenAt,
  getShopLocalDayMinute,
  weekdayFromDate,
  MINUTES_PER_DAY,
  type OpeningHourEntry,
  type ShopOpeningMinutes
} from '../src/lib/utils/shops/derived';
import {
  aggregateGames,
  formatAddressParts,
  formatOpeningHourLiteral
} from '../src/lib/utils/index';
import {
  EARTH_RADIUS_KM,
  buildShopGeoFilter,
  buildShopMeiliFilter,
  buildShopMongoCountFilter,
  buildShopMongoFilter,
  buildShopMongoPredicate,
  buildTextCondition,
  combineMongoFilters,
  describeShopSearchStrategy
} from '../src/lib/utils/shops/filter-query.server';
import type { Filter } from 'mongodb';
import type { Shop } from '../src/lib/types';
import {
  countActiveFilters,
  parseLegacyRegionId,
  parseShopFilterParam,
  readGlobeFilterState,
  readShopFilterState,
  readShopPageQuery,
  sanitizeShopFilterState,
  serializeShopFilterState,
  writeShopPageQuery
} from '../src/lib/utils/shops/filter';
import { emptyShopFilterState, normalizeShopFilterState } from '../src/lib/schemas/shop-filter';
import type { ShopFilterGameExpr, ShopFilterState } from '../src/lib/schemas/shop-filter';

const suites: Array<{ name: string; run: () => Promise<void> }> = [];
const suite = (name: string, run: () => Promise<void>) => suites.push({ name, run });

const hm = (hour: number, minute = 0) => ({ hour, minute });
const pair = (open: number, close: number, minute = 0): OpeningHourEntry => [
  hm(open, minute),
  hm(close, minute)
];
const pairHM = (openH: number, openM: number, closeH: number, closeM = 0): OpeningHourEntry => [
  hm(openH, openM),
  hm(closeH, closeM)
];

// ── Suite: opening-hours canonicalization ───────────────────────────────────
suite('hours/canonicalize', async () => {
  assert.deepEqual(canonicalizeOpeningHours([pair(10, 22)]), [[hm(10), hm(22)]]);
  // Legacy wraparound lifts past midnight.
  assert.deepEqual(canonicalizeOpeningHours([pair(22, 2)]), [[hm(22), hm(26)]]);
  // Equal sides mean 24 hours (Japanese 0:00–0:00 convention).
  assert.deepEqual(canonicalizeOpeningHours([pair(0, 0)]), [[hm(0), hm(24)]]);
  assert.deepEqual(canonicalizeOpeningHours([pair(10, 10)]), [[hm(10), hm(34)]]);
  // An open side past midnight folds back into the same day.
  assert.deepEqual(canonicalizeOpeningHours([pairHM(25, 30, 28)]), [[hm(1, 30), hm(28)]]);
  // Idempotent.
  const once = canonicalizeOpeningHours([pair(22, 2)]);
  assert.deepEqual(canonicalizeOpeningHours(once), once);
});

// ── Suite: display contract for the "closes tomorrow" marker ─────────────────
// The shop-detail page decides whether to render `tomorrow` from the canonical
// close hour and renders the wall clock via `formatOpeningHourLiteral`. Both
// must agree with the minute model the filter engine and the globe consume —
// the page used to clamp the close hour to 23 and silently drop the marker.
suite('hours/display-tomorrow-marker', async () => {
  const closesNextDay = (entry: OpeningHourEntry) =>
    canonicalizeOpeningHourPair(entry[0], entry[1])[1].hour >= 24;

  // Closing at midnight is a next-day close, rendered as 00:00.
  assert.equal(closesNextDay(pair(10, 24)), true);
  assert.equal(formatOpeningHourLiteral(hm(24)), '00:00');
  // A same-day window is not.
  assert.equal(closesNextDay(pair(10, 22)), false);
  assert.equal(formatOpeningHourLiteral(hm(22)), '22:00');
  // A past-midnight close renders the folded wall clock, never the raw offset.
  assert.equal(closesNextDay(pair(22, 26)), true);
  assert.equal(formatOpeningHourLiteral(hm(26)), '02:00');

  // The marker agrees with the minute model across the whole close range: a
  // close at or past minute 1440 lands on the next calendar day, which is not
  // the same test as a session lasting 24h or more (10:00→24:00 is 14h).
  for (const [open, close] of [
    [10, 24],
    [10, 22],
    [22, 26],
    [0, 24],
    [9, 47]
  ] as const) {
    const entry = pair(open, close);
    const [[{ o, c }]] = computeOpeningMinutes([entry]);
    assert.equal(closesNextDay(entry), c >= MINUTES_PER_DAY, `open=${open} close=${close} c=${c}`);
    // The user-time path derives its close as open + (c - o) minutes.
    assert.ok(c - o > 0 && c - o < 2 * MINUTES_PER_DAY, `open=${open} close=${close} len=${c - o}`);
  }
});

// ── Suite: openingMinutes derivation ────────────────────────────────────────
suite('hours/opening-minutes', async () => {
  // Single entry applies to the whole week.
  const wholeWeek = computeOpeningMinutes([pair(10, 22)]);
  assert.equal(wholeWeek.length, 7);
  for (const day of wholeWeek) assert.deepEqual(day, [{ o: 600, c: 1320 }]);

  // Input rows are Monday-first and the output keeps that index
  // (0 = Monday … 6 = Sunday) — one convention app-wide.
  const mondayFirst = [
    pair(9, 21), // Monday
    pair(9, 21), // Tuesday
    pair(9, 21), // Wednesday
    pair(9, 21), // Thursday
    pair(9, 21), // Friday
    pair(10, 22), // Saturday
    pair(11, 23) // Sunday
  ];
  // Weekday convention is Monday-first everywhere (0 = Monday … 6 = Sunday),
  // matching the `openingHours` rows; `weekdayFromDate` is the single
  // Date → weekday conversion point.
  assert.equal(weekdayFromDate(new Date('2026-06-15T12:00:00Z')), 0); // Monday
  assert.equal(weekdayFromDate(new Date('2026-06-21T12:00:00Z')), 6); // Sunday
  const minutes = computeOpeningMinutes(mondayFirst);
  assert.deepEqual(minutes[0], [{ o: 540, c: 1260 }]); // Monday → row 0
  assert.deepEqual(minutes[5], [{ o: 600, c: 1320 }]); // Saturday → row 5
  assert.deepEqual(minutes[6], [{ o: 660, c: 1380 }]); // Sunday → row 6
});

// ── Suite: hour matchers ────────────────────────────────────────────────────
suite('hours/matchers', async () => {
  const overnight = computeOpeningMinutes([pair(22, 26)]) as ShopOpeningMinutes;
  // Same-day late-night portion via extended minutes.
  assert.equal(isOpenAtMinutes(overnight, 3, 1500), true); // 25:00
  assert.equal(isOpenAtMinutes(overnight, 3, 1560), false); // 26:00 = closing edge
  // Early morning belongs to the previous day's session.
  assert.equal(isOpenAtMinutes(overnight, 3, 60), true); // 01:00 via spill
  assert.equal(isOpenAtMinutes(overnight, 3, 1439), true);
  assert.equal(isOpenAtMinutes(overnight, 3, 900), false); // 15:00 — closed

  assert.equal(closesFromMinutes(overnight, 3, 1500), true); // extends past 25:00
  assert.equal(closesFromMinutes(overnight, 3, 1560), true); // extends to exactly 26:00
  assert.equal(closesFromMinutes(overnight, 3, 1561), false);
  assert.equal(opensByMinutes(overnight, 3, 1320), true); // opens by 22:00
  assert.equal(opensByMinutes(overnight, 3, 1319), false);

  const daytime = computeOpeningMinutes([pair(10, 22)]) as ShopOpeningMinutes;
  assert.equal(isOpenAtMinutes(daytime, 3, 900), true);
  assert.equal(isOpenAtMinutes(daytime, 3, 60), false); // no overnight spill
});

// ── Suite: exact open state (timezone-aware) ────────────────────────────────
suite('hours/open-now', async () => {
  const tokyoLocation = {
    type: 'Point' as const,
    coordinates: [139.69, 35.68] as [number, number]
  };
  const tokyoShop = {
    location: tokyoLocation,
    openingHours: [pair(22, 26)]
  };
  // 2026-06-15T16:00Z = Tuesday 01:00 JST → inside the whole-week
  // 22:00–26:00 session (single-entry shape applies to every day).
  assert.equal(isShopOpenAt(tokyoShop, new Date('2026-06-15T16:00:00Z')), true);
  // 2026-06-15T06:00Z = Monday 15:00 JST → closed.
  assert.equal(isShopOpenAt(tokyoShop, new Date('2026-06-15T06:00:00Z')), false);
  // isClosed always wins.
  assert.equal(
    isShopOpenAt({ ...tokyoShop, isClosed: true }, new Date('2026-06-15T16:00:00Z')),
    false
  );
  // Monday-first 7-entry rows: index 5 = Saturday; Sunday 01:00 JST is
  // covered by the Saturday overnight session.
  const weekly = {
    location: tokyoLocation,
    openingHours: [
      pair(9, 21),
      pair(9, 21),
      pair(9, 21),
      pair(9, 21),
      pair(9, 21),
      pair(22, 26),
      pair(9, 21)
    ]
  };
  // 2026-06-19T16:00Z = Saturday 01:00 JST → before Saturday's 22:00 opening
  // and after Friday's 21:00 close (no Friday spill) → closed.
  assert.equal(isShopOpenAt(weekly, new Date('2026-06-19T16:00:00Z')), false);
  // 2026-06-20T16:00Z = Sunday 01:00 JST → covered by the Saturday
  // 22:00–26:00 session spilling past midnight.
  assert.equal(isShopOpenAt(weekly, new Date('2026-06-20T16:00:00Z')), true);
});

// ── Suite: DST — the offset must follow the instant, not the zone ────────────
// Regression: a UTC offset was once memoized in a Map keyed by zone name. The
// first caller to touch a zone fixed its offset for the whole process, so a
// server that warmed up in winter reported the winter offset through summer —
// open/closed state silently shifted by an hour for every DST zone. Both
// assertions below resolve a DIFFERENT offset for the same zone, so they fail
// against any name-keyed memoization. The pre-existing hours/open-now suite
// only exercises Tokyo, which has no DST and therefore never caught this.
suite('hours/dst-offset-follows-instant', async () => {
  // Same local wall clock (09:30), reached at different UTC instants because
  // the zones are on different offsets in January and July.
  const NY_WINTER = new Date('2026-01-15T14:30:00Z'); // EST -5 → 09:30
  const NY_SUMMER = new Date('2026-07-15T13:30:00Z'); // EDT -4 → 09:30
  const AT_0930 = 9 * 60 + 30;

  assert.equal(getShopLocalDayMinute('America/New_York', NY_WINTER).minute, AT_0930);
  assert.equal(getShopLocalDayMinute('America/New_York', NY_SUMMER).minute, AT_0930);

  // Europe/London: UTC+0 in January, UTC+1 in July.
  assert.equal(
    getShopLocalDayMinute('Europe/London', new Date('2026-01-15T09:30:00Z')).minute,
    AT_0930
  );
  assert.equal(
    getShopLocalDayMinute('Europe/London', new Date('2026-07-15T08:30:00Z')).minute,
    AT_0930
  );

  // Southern hemisphere inverts the direction: Sydney is UTC+11 in January and
  // UTC+10 in July, so the winter call comes second on purpose.
  assert.equal(
    getShopLocalDayMinute('Australia/Sydney', new Date('2026-07-15T23:30:00Z')).minute,
    AT_0930
  );
  assert.equal(
    getShopLocalDayMinute('Australia/Sydney', new Date('2026-01-15T22:30:00Z')).minute,
    AT_0930
  );

  // Non-DST zones stay put (guards the opposite mistake: recomputing wrongly).
  assert.equal(
    getShopLocalDayMinute('Asia/Shanghai', new Date('2026-01-15T18:30:00Z')).minute,
    2 * 60 + 30
  );
  assert.equal(
    getShopLocalDayMinute('Asia/Shanghai', new Date('2026-07-15T18:30:00Z')).minute,
    2 * 60 + 30
  );

  // End-to-end through the open/closed decision, which is what users see:
  // a 09:00–17:00 shop must read as open at 09:30 local in BOTH seasons.
  const nyShop = {
    location: { type: 'Point' as const, coordinates: [-74.006, 40.71] as [number, number] },
    timezone: { name: 'America/New_York' },
    openingHours: [pair(9, 17)]
  };
  assert.equal(isShopOpenAt(nyShop, NY_WINTER), true);
  assert.equal(isShopOpenAt(nyShop, NY_SUMMER), true);
});

// ── Suite: game aggregation ─────────────────────────────────────────────────
suite('games/aggregation', async () => {
  const shop = {
    games: [
      { titleId: 1, quantity: 1 },
      { titleId: 1, quantity: 1 },
      { titleId: 3, quantity: 3 }
    ]
  };
  assert.deepEqual(aggregateGameQuantities(shop.games), [
    { titleId: 1, quantity: 2 },
    { titleId: 3, quantity: 3 }
  ]);
  assert.deepEqual(
    aggregateGames(shop).map((game) => ({ titleId: game.titleId, quantity: game.quantity })),
    [
      { titleId: 1, quantity: 2 },
      { titleId: 3, quantity: 3 }
    ]
  );
  assert.deepEqual(computeGameTokens([{ titleId: 1, quantity: 2 }]), [
    't1',
    't1q0',
    't1q1',
    't1q2'
  ]);
});

// ── Suite: game expression → Mongo + reference evaluation ───────────────────
type FixtureGame = { titleId: number; quantity: number };
const FIXTURES: Record<string, FixtureGame[]> = {
  twoMaimaiAndSdvx: [
    { titleId: 1, quantity: 1 },
    { titleId: 1, quantity: 1 },
    { titleId: 4, quantity: 3 }
  ],
  singleMaimai: [{ titleId: 1, quantity: 1 }],
  chunithmOnly: [{ titleId: 3, quantity: 2 }],
  empty: []
};

const evalLeaf = (
  games: FixtureGame[],
  leaf: { titleIds?: number[]; quantity?: { min?: number; max?: number } }
) => {
  const aggregated = aggregateGameQuantities(games);
  return aggregated.some(
    (entry) =>
      (!leaf.titleIds || leaf.titleIds.includes(entry.titleId)) &&
      (leaf.quantity?.min === undefined || entry.quantity >= leaf.quantity.min) &&
      (leaf.quantity?.max === undefined || entry.quantity <= leaf.quantity.max)
  );
};
const evalExpr = (games: FixtureGame[], expr: ShopFilterGameExpr): boolean =>
  expr.op === 'and'
    ? expr.children.every((child) =>
        'op' in child ? evalExpr(games, child) : evalLeaf(games, child)
      )
    : expr.children.some((child) =>
        'op' in child ? evalExpr(games, child) : evalLeaf(games, child)
      );

/** Minimal in-memory interpreter for the Mongo subset the builder emits. */
const evalMongo = (filter: Record<string, unknown>, shop: { games: FixtureGame[] }): boolean => {
  const entries = Object.entries(filter);
  return entries.every(([key, value]) => {
    if (key === '$and')
      return (value as Record<string, unknown>[]).every((part) => evalMongo(part, shop));
    if (key === '$or')
      return (value as Record<string, unknown>[]).some((part) => evalMongo(part, shop));
    if (key === '$expr') return true; // stats predicates are out of scope here
    if (key === 'games.titleId')
      return shop.games.some((game) => (value as { $in: number[] }).$in.includes(game.titleId));
    if (key === 'aggGames') {
      const aggregated = aggregateGameQuantities(shop.games);
      const condition = (value as { $elemMatch: Record<string, unknown> }).$elemMatch;
      return aggregated.some((entry) => {
        if (
          condition.titleId &&
          !(condition.titleId as { $in: number[] }).$in.includes(entry.titleId)
        )
          return false;
        const quantity = condition.quantity as { $gte?: number; $lte?: number } | undefined;
        if (quantity?.$gte !== undefined && entry.quantity < quantity.$gte) return false;
        if (quantity?.$lte !== undefined && entry.quantity > quantity.$lte) return false;
        return true;
      });
    }
    throw new Error(`Unhandled mongo filter key: ${key}`);
  });
};

suite('games/expression-translation', async () => {
  const expressions: ShopFilterGameExpr[] = [
    { op: 'or', children: [{ titleIds: [1, 3] }] },
    { op: 'and', children: [{ titleIds: [1] }, { titleIds: [4] }] },
    { op: 'and', children: [{ titleIds: [1], quantity: { min: 2 } }] },
    {
      op: 'or',
      children: [
        { titleIds: [11] },
        { op: 'and', children: [{ titleIds: [4] }, { quantity: { min: 2 } }] }
      ]
    }
  ];
  for (const expr of expressions) {
    const mongoFilter = buildShopMongoFilter({ v: 1, games: expr } as ShopFilterState);
    for (const [name, games] of Object.entries(FIXTURES)) {
      assert.equal(
        evalMongo(mongoFilter as Record<string, unknown>, { games }),
        evalExpr(games, expr),
        `mismatch for fixture ${name} on ${JSON.stringify(expr)}`
      );
    }
  }
  // Title-only leaves avoid the aggGames cache dependency.
  const titleOnly = buildShopMongoFilter({
    v: 1,
    games: { op: 'and', children: [{ titleIds: [1] }, { titleIds: [4] }] }
  } as ShopFilterState);
  assert.ok(JSON.stringify(titleOnly).includes('games.titleId'));
});

// ── Suite: Meilisearch filter strings ───────────────────────────────────────
suite('meili/filter-builder', async () => {
  assert.equal(
    buildShopMeiliFilter({ v: 1, regions: ['CN', 'JP'] } as ShopFilterState),
    '(address.region = "CN" OR address.region = "JP")'
  );
  const compound = buildShopMeiliFilter({
    v: 1,
    games: { op: 'and', children: [{ titleIds: [1], quantity: { min: 2, max: 3 } }] }
  } as ShopFilterState);
  assert.equal(compound, 'gameTokens IN [t1q2, t1q3]');
  // Grouping preserves precedence.
  const grouped = buildShopMeiliFilter({
    v: 1,
    games: {
      op: 'or',
      children: [
        { titleIds: [11] },
        { op: 'and', children: [{ titleIds: [4] }, { quantity: { min: 2 } }] }
      ]
    }
  } as ShopFilterState);
  assert.equal(
    grouped,
    '(games.titleId IN [11] OR (games.titleId IN [4] AND games.quantity >= 2))'
  );
  // Time-dependent, geo, and activity filters are not expressible — the
  // strategy never asks, but the builder must refuse rather than approximate.
  assert.equal(buildShopMeiliFilter({ v: 1, hours: { openNow: true } } as ShopFilterState), null);
  assert.equal(
    buildShopMeiliFilter({
      v: 1,
      hours: { closesFrom: { days: { set: [5] }, minute: 1500 } }
    } as ShopFilterState),
    null
  );
  assert.equal(
    buildShopMeiliFilter({
      v: 1,
      geo: { mode: 'near', lat: 35, lng: 139, radiusKm: 5 }
    } as ShopFilterState),
    null
  );
  assert.equal(
    buildShopMeiliFilter({ v: 1, status: { closed: 'only' } } as ShopFilterState),
    'isClosed = true'
  );
});

// ── Suite: URL serialization ────────────────────────────────────────────────
suite('url/round-trip', async () => {
  const state: ShopFilterState = {
    v: 1,
    regions: ['CN', 'JP-13'],
    games: { op: 'and', children: [{ titleIds: [1], quantity: { min: 2 } }, { titleIds: [4] }] },
    hours: {
      openNow: true,
      closesFrom: { days: { set: [0, 6], quantifier: 'any' }, minute: 1500 }
    },
    status: { closed: 'exclude' }
  };
  const roundTripped = parseShopFilterParam(serializeShopFilterState(state));
  assert.deepEqual(roundTripped, state);

  // Empty state serializes without an `f` param.
  const emptyParams = writeShopPageQuery({
    q: '',
    sort: 'relevance',
    page: 1,
    filter: emptyShopFilterState()
  });
  assert.equal(emptyParams.toString(), '');

  // Legacy params map into the state.
  const legacy = new URLSearchParams({ titleIds: '1, 3', regionId: 'CN' });
  const mapped = readShopFilterState(legacy);
  assert.deepEqual(mapped.regions, ['CN']);
  assert.deepEqual(mapped.games, {
    op: 'and',
    children: [{ titleIds: [1] }, { titleIds: [3] }]
  });

  // `f` wins over legacy params.
  const both = new URLSearchParams({
    titleIds: '1',
    f: serializeShopFilterState({ v: 1, regions: ['JP'] })
  });
  assert.deepEqual(readShopFilterState(both), { v: 1, regions: ['JP'] });

  // Invalid payloads degrade to "no filter".
  assert.equal(parseShopFilterParam('not-base64!!'), null);
  assert.equal(parseShopFilterParam(Buffer.from('{"v":2}').toString('base64url')), null);

  // Page query defaults: numeric q keeps relevance; empty q falls to name.
  const pageQuery = readShopPageQuery(new URLSearchParams('q=1234'));
  assert.equal(pageQuery.sort, 'relevance');
  assert.deepEqual(pageQuery.filter, { v: 1 });

  assert.equal(countActiveFilters(emptyShopFilterState()), 0);
  // regions + games + hours(openNow, closesFrom) + status = 5 dimensions.
  assert.equal(countActiveFilters(state), 5);
});

// ── Suite: panel output is always schema-valid ──────────────────────────────
// The panel editor intentionally keeps partially-filled rows, so anything it
// can produce must survive sanitize → serialize → parse. A single rejected
// field used to make parseShopFilterParam return null, silently discarding
// every unrelated section of the filter.
suite('url/sanitize-round-trip', async () => {
  const roundTrip = (state: ShopFilterState): ShopFilterState | null =>
    parseShopFilterParam(serializeShopFilterState(sanitizeShopFilterState(state)));

  // A schedule row with no weekday picked is dropped, siblings survive.
  const emptyDaySet = roundTrip({
    v: 1,
    regions: ['JP'],
    hours: { openAt: { days: { set: [], quantifier: 'any' }, minute: 1200 }, openNow: true }
  } as ShopFilterState);
  assert.deepEqual(emptyDaySet, { v: 1, regions: ['JP'], hours: { openNow: true } });

  // Inverted and non-integer bounds are ordered and clamped, never rejected.
  const inverted = roundTrip({
    v: 1,
    regions: ['JP'],
    machines: { machineCount: { min: 5, max: 2 } },
    activity: { attendance: { min: 3.7, max: 1 } }
  } as ShopFilterState);
  assert.deepEqual(inverted, {
    v: 1,
    regions: ['JP'],
    machines: { machineCount: { min: 2, max: 5 } },
    activity: { attendance: { min: 1, max: 3 } }
  });

  // Per-game attendance rows keep their title and lose only the empty ones.
  const perGame = roundTrip({
    v: 1,
    activity: { gameAttendance: [{ titleIds: [1], min: 4, max: 1 }, { titleIds: [] }] }
  } as unknown as ShopFilterState);
  assert.deepEqual(perGame, {
    v: 1,
    activity: { gameAttendance: [{ titleIds: [1], min: 1, max: 4 }] }
  });

  // Empty game leaves/groups are dropped; the rest of the filter survives.
  const emptyLeaves = roundTrip({
    v: 1,
    regions: ['CN'],
    games: { op: 'and', children: [{}, { titleIds: [2] }] }
  } as unknown as ShopFilterState);
  assert.deepEqual(emptyLeaves, {
    v: 1,
    regions: ['CN'],
    games: { op: 'and', children: [{ titleIds: [2] }] }
  });

  // An all-default filter stays clean (no `f` param) after sanitizing.
  assert.deepEqual(roundTrip({ v: 1, machines: {}, hours: {} } as ShopFilterState), { v: 1 });
});

// ── Suite: the badge, the URL and the query builders must all agree ─────────
// Neither `buildShopMongoFilter` nor `buildShopMeiliFilter` acts on
// `status.closed = 'include'` or `advanced.claim = 'any'`, so such a state must
// not count as an active filter nor serialize into a redundant `f` parameter.
// The panel also creates half-finished shapes on purpose (an added but
// unselected game requirement, a date field that was typed into and cleared),
// and those used to show up as phantom "1 active" badges.
suite('url/no-op-filters-are-not-active', async () => {
  const emptySerialized = serializeShopFilterState(emptyShopFilterState());

  const noOps: Array<[string, ShopFilterState]> = [
    ['status include', { v: 1, status: { closed: 'include' } }],
    ['claim any', { v: 1, advanced: { claim: 'any' } }],
    ['empty advanced', { v: 1, advanced: {} }],
    ['empty machines', { v: 1, machines: {} }],
    ['empty activity', { v: 1, activity: {} }],
    ['false hours flags', { v: 1, hours: { openNow: false, is24h: false } }],
    ['empty weekly', { v: 1, hours: { weekly: {} } }],
    ['unparseable date', { v: 1, advanced: { createdAfter: 'not-a-date' } }],
    ['empty game leaf', { v: 1, games: { op: 'or', children: [{ titleIds: [] }] } }],
    ['empty game group', { v: 1, games: { op: 'and', children: [{ op: 'or', children: [{}] }] } }],
    ['dayless schedule row', { v: 1, hours: { openAt: { days: { set: [] }, minute: 1200 } } }]
  ];
  for (const [name, state] of noOps) {
    assert.equal(countActiveFilters(state), 0, `${name} must not count as active`);
    assert.deepEqual(
      sanitizeShopFilterState(state as ShopFilterState),
      { v: 1 },
      `${name} must sanitize away`
    );
    assert.equal(
      serializeShopFilterState(sanitizeShopFilterState(state as ShopFilterState)),
      emptySerialized,
      `${name} must not add an f param`
    );
    // A hand-edited URL carrying the same shape either degrades to "no
    // filter" (the strict schema rejects it outright) or normalizes to one —
    // it must never come back as something the badge counts.
    const parsed = parseShopFilterParam(serializeShopFilterState(state as ShopFilterState));
    if (parsed) {
      assert.deepEqual(parsed, { v: 1 }, `${name} must not survive a URL round trip`);
      assert.equal(countActiveFilters(parsed), 0, `${name} must not count as active after parsing`);
    }
  }

  // A no-op sibling never hides a real one.
  const mixed: ShopFilterState = {
    v: 1,
    regions: ['JP'],
    status: { closed: 'include' },
    advanced: { claim: 'any', createdAfter: '2024-01-01T00:00:00.000Z' }
  };
  assert.equal(countActiveFilters(mixed), 2);
  assert.deepEqual(normalizeShopFilterState(mixed), {
    v: 1,
    regions: ['JP'],
    advanced: { createdAfter: '2024-01-01T00:00:00.000Z' }
  });

  // Normalizing is idempotent, and never rejects.
  const idempotencyCases: ShopFilterState[] = [
    ...noOps.map(([, state]) => state as ShopFilterState),
    mixed,
    { v: 1, games: { op: 'and', children: [{ titleIds: [1] }, { quantity: { min: 2 } }] } },
    {
      v: 1,
      hours: { openAt: { days: { set: [1, 2] }, minute: 1200 }, is24h: true }
    }
  ];
  for (const state of idempotencyCases) {
    const once = normalizeShopFilterState(state);
    assert.deepEqual(
      normalizeShopFilterState(once),
      once,
      `${JSON.stringify(state)} not idempotent`
    );
  }

  // Real filters keep counting, one point per engaged row / flag.
  const engaged: ShopFilterState = {
    v: 1,
    hours: {
      openNow: true,
      weekly: { minOpenDays: 5 },
      openAt: { days: { set: [0, 1] }, minute: 1200 }
    }
  };
  assert.equal(countActiveFilters(engaged), 3);
  assert.equal(countActiveFilters(sanitizeShopFilterState(engaged)), 3);
  assert.deepEqual(
    parseShopFilterParam(serializeShopFilterState(sanitizeShopFilterState(engaged))),
    engaged
  );
});

// ── Suite: region chips ─────────────────────────────────────────────────────
// The panel deliberately accepts any node in the cascade chain, not just the
// leaf, so a broader area (a country, a province) can be filtered on directly.
// Chips label a node with its own localized name plus its ancestor path
// formatted by the same `formatAddressParts` helper the region rankings use.
suite('region/chip-labels-and-broad-regions', async () => {
  // Ancestor path formatting: CJK locales keep the root → parent order,
  // Western locales read it parent → root.
  assert.equal(formatAddressParts([], 'en'), '');
  assert.equal(formatAddressParts(['United States'], 'en'), 'United States');
  assert.equal(
    formatAddressParts(['United States', 'California'], 'en'),
    'California, United States'
  );
  assert.equal(formatAddressParts(['中国', '加利福尼亚'], 'zh-CN'), '中国 · 加利福尼亚');
  assert.equal(formatAddressParts(['日本', '東京都'], 'ja'), '日本 · 東京都');

  // A non-leaf region ID is a first-class filter value: it survives
  // sanitize/serialize/parse and counts as one active region filter.
  const broad: ShopFilterState = { v: 1, regions: ['JP'] };
  const broadAndLeaf: ShopFilterState = { v: 1, regions: ['JP', 'JP-13'] };
  for (const state of [broad, broadAndLeaf]) {
    const sanitized = sanitizeShopFilterState(state);
    assert.deepEqual(sanitized, state, 'a broad region must not be dropped');
    assert.equal(countActiveFilters(state), 1, 'regions count as a single active filter');
    assert.deepEqual(parseShopFilterParam(serializeShopFilterState(state)), state);
  }

  // Both backends match a region ID against the stored root → leaf chain, so an
  // ancestor ID already selects every descendant — no leaf expansion needed.
  assert.deepEqual(buildShopMongoFilter(broad), {
    'address.region': { $in: ['JP'] }
  } as never);
  assert.equal(
    buildShopMeiliFilter(broad),
    '(address.region = "JP")',
    'a broad region must produce the same Meili predicate as a leaf'
  );
  assert.deepEqual(buildShopMongoFilter(broadAndLeaf), {
    'address.region': { $in: ['JP', 'JP-13'] }
  } as never);
});

// ── Suite: globe region folds into the one filter ───────────────────────────
// The globe used to carry its region as a parameter beside `f` and translate it
// into a separate server-side constraint. Both spellings now mean the same thing
// as a `regions` slot, so an old drill link and a panel selection reach the same
// query — and the globe's own links stay locale-independent.
suite('globe/region-param-folds-into-filter', async () => {
  // The old drill-link format: a base64 chain carrying every locale's names.
  const legacyChain = btoa(
    encodeURIComponent(
      JSON.stringify([
        { id: 'CN', name: { en: 'China', zh: '中国', ja: '中国' } },
        { id: 'CN-31', name: { en: 'Shanghai', zh: '上海市', ja: '上海市' } }
      ])
    )
  );

  assert.equal(parseLegacyRegionId('CN-310000'), 'CN-310000', 'a bare region ID decodes to itself');
  assert.equal(
    parseLegacyRegionId(legacyChain),
    'CN-31',
    'a base64 chain decodes to its leaf ID — names are resolved server-side'
  );
  for (const junk of ['', '   ', 'not base64 %%%', btoa('"a string"'), btoa('[1,2,3]')]) {
    assert.equal(parseLegacyRegionId(junk), null, `junk must not decode: ${junk}`);
  }

  const globeParams = (query: string) => new URLSearchParams(query);

  assert.equal(readGlobeFilterState(globeParams('')), undefined, 'no filter at all');

  // A legacy link alone still selects a region.
  assert.deepEqual(readGlobeFilterState(globeParams(`region=${legacyChain}`)), {
    v: 1,
    regions: ['CN-31']
  });

  // A link carrying both keeps every dimension and unions the region — the
  // region is one more filter chip, not a separate constraint.
  const withGames = serializeShopFilterState({
    v: 1,
    regions: ['CN-32'],
    hours: { openNow: true }
  });
  const merged = readGlobeFilterState(
    globeParams(`f=${encodeURIComponent(withGames)}&region=CN-31`)
  );
  assert.deepEqual(merged, {
    v: 1,
    regions: ['CN-32', 'CN-31'],
    hours: { openNow: true }
  });
  assert.equal(countActiveFilters(merged!), 2, 'region + hours are two active filters');

  // Carrying the same region twice must not double-count it.
  const duplicated = readGlobeFilterState(
    globeParams(`f=${encodeURIComponent(withGames)}&region=CN-32`)
  );
  assert.deepEqual(duplicated, { v: 1, regions: ['CN-32'], hours: { openNow: true } });

  // What the globe writes back replaces the legacy parameter outright: if it
  // stayed, reloading a drilled-up link would resurrect the old region.
  assert.deepEqual(readGlobeFilterState(globeParams(`f=${withGames}`)), {
    v: 1,
    regions: ['CN-32'],
    hours: { openNow: true }
  });
});

// ── Suite: geo must constrain the total, not just the page ──────────────────
// `$geoNear` (which orders by distance) cannot be expressed as a query filter,
// so the fetch and the count apply the radius through different operators. They
// must describe the same circle — otherwise "near me" silently reported the
// unfiltered total and page 2 of 9 led to an empty page.
suite('mongo/geo-applies-to-total', async () => {
  const tokyo = {
    mode: 'near',
    lat: 35.6812,
    lng: 139.7671,
    radiusKm: 10
  } as const;

  // No geo → no radius predicate, and the total stays exactly the plain filter.
  assert.equal(buildShopGeoFilter({ v: 1 } as ShopFilterState), null);
  const plain: ShopFilterState = { v: 1, regions: ['JP-13'] };
  assert.deepEqual(
    buildShopMongoCountFilter(plain, ''),
    buildShopMongoFilter(plain),
    'without geo the total must be unchanged'
  );

  // With geo → the radius joins the total.
  const geoFilter: ShopFilterState = { ...plain, geo: tokyo };
  assert.deepEqual(buildShopGeoFilter(geoFilter), {
    location: { $geoWithin: { $centerSphere: [[139.7671, 35.6812], 10 / EARTH_RADIUS_KM] } }
  });
  const geoCount = buildShopMongoCountFilter(geoFilter, '');
  assert.notDeepEqual(
    geoCount,
    buildShopMongoFilter(geoFilter),
    'the total must not stay the unfiltered predicate when near-me is on'
  );
  assert.deepEqual(geoCount, {
    $and: [buildShopMongoFilter(geoFilter), buildShopGeoFilter(geoFilter)]
  });

  // The radius is strictly monotonic: a tighter radius is a smaller angle.
  const wide = buildShopGeoFilter({ ...geoFilter, geo: { ...tokyo, radiusKm: 50 } });
  const narrow = buildShopGeoFilter({ ...geoFilter, geo: { ...tokyo, radiusKm: 1 } });
  const angleOf = (filter: Filter<Shop> | null): number =>
    (
      filter as unknown as {
        location: { $geoWithin: { $centerSphere: [number[], number] } };
      }
    ).location.$geoWithin.$centerSphere[1];
  assert.ok(angleOf(narrow) < angleOf(buildShopGeoFilter(geoFilter)));
  assert.ok(angleOf(buildShopGeoFilter(geoFilter)) < angleOf(wide));

  // The search text belongs to the total *and* to the fetched page, including
  // on the geo path — it used to be dropped there, so a typed query silently
  // became "everything nearby".
  const geoText = buildShopMongoCountFilter(geoFilter, 'maimai');
  const textCondition = buildTextCondition('maimai');
  assert.deepEqual(buildShopMongoPredicate(geoFilter, 'maimai'), {
    $and: [buildShopMongoFilter(geoFilter), textCondition]
  });
  assert.deepEqual(geoText, {
    $and: [buildShopMongoFilter(geoFilter), textCondition, buildShopGeoFilter(geoFilter)]
  });
  // A blank query adds nothing.
  assert.deepEqual(
    buildShopMongoPredicate(geoFilter, '   '),
    buildShopMongoPredicate(geoFilter, '')
  );

  // Geo is never routed to Meili, which has no radius predicate.
  assert.equal(describeShopSearchStrategy({ v: 1, geo: tokyo } as ShopFilterState, ''), 'mongo');
  assert.equal(
    describeShopSearchStrategy({ v: 1, geo: tokyo } as ShopFilterState, 'maimai'),
    'mongo-text'
  );

  // The globe surface (same filter panel, same ShopFilterState) builds its own
  // predicate: a base filter of region + legacy title ids that may already be an
  // `$and` group, plus the radius. Its sidebar total, by-name page and marker set
  // all use this composition instead of `$geoNear`, so the radius has to survive
  // it — and combining must stay flat rather than nesting a second `$and`.
  const globeBase = {
    $and: [{ 'address.region': 'JP-13' }, { games: { $all: [{ $elemMatch: { titleId: 1 } }] } }]
  } as unknown as Filter<Shop>;
  const globeRadius = buildShopGeoFilter(geoFilter);
  const globeQuery = combineMongoFilters(globeBase, globeRadius);
  assert.deepEqual(globeQuery, {
    $and: [
      { 'address.region': 'JP-13' },
      { games: { $all: [{ $elemMatch: { titleId: 1 } }] } },
      globeRadius
    ]
  } as never);
  assert.notDeepEqual(globeQuery, globeBase, 'the globe query must not stay unfiltered');
  // A globe call without any other constraint still gets the radius, and nothing
  // else — no empty `$and` wrapper around a single predicate.
  assert.deepEqual(combineMongoFilters({}, globeRadius), globeRadius);
  assert.deepEqual(combineMongoFilters({}, null), {} as never);
  // Idempotent: re-combining an already-combined query keeps the same shape.
  assert.deepEqual(combineMongoFilters(globeQuery, null), globeQuery);
});

// ── Entry ───────────────────────────────────────────────────────────────────
let failed = 0;
for (const { name, run } of suites) {
  try {
    await run();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(err);
  }
}
if (failed > 0) {
  console.error(`\n${failed} suite(s) failed`);
  process.exit(1);
}
console.log('\nAll shop filter suites passed');

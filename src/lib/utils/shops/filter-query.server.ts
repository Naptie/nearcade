/**
 * Filter → query translation for the shop query engine (server-only).
 *
 * Turns a `ShopFilterState` into a MongoDB filter or a Meilisearch filter
 * string, and picks the execution strategy. No DB, no env, no Redis — so the
 * validation script can exercise it without a running app, and every consumer
 * shares one translation of the filter semantics.
 *
 * The `.server` suffix is doing real work: it makes SvelteKit reject any client
 * import at build time. That is the guarantee behind the split from `filter.ts`
 * — the URL contract is needed in the browser, this translation is not, and
 * before the suffix that was convention rather than something the compiler
 * checked. Keep it.
 *
 * Strategy matrix (see `describeShopSearchStrategy`):
 *
 *   - `mongo`      — no text query. Exact for every filter.
 *   - `mongo-text` — text query present AND the filter contains something no
 *                    index can answer exactly (the name constraint, time-
 *                    dependent open-now, shop-local schedule requirements,
 *                    Redis-derived activity, geo). Text falls back to the
 *                    regex pattern so semantics stay exact.
 *   - `meili`      — text query present AND every active filter is
 *                    index-expressible: relevance ranking + highlighting.
 *                    Compound game leaves rely on the per-entry `gameTokens`
 *                    denormalization (Meili `AND` is otherwise cross-object).
 */
import type { Filter } from 'mongodb';

import { buildSearchPattern, escapeForRegExp } from '$lib/utils/search';
import type { Shop } from '$lib/types';
import { GAME_TOKEN_QUANTITY_CAP } from '$lib/utils/shops/derived';
import type {
  ShopFilterGameExpr,
  ShopFilterGameLeaf,
  ShopFilterState,
  ShopSearchSort
} from '$lib/schemas/shop-filter';

export type ShopSearchStrategy = 'mongo' | 'mongo-text' | 'meili';

export const MINUTES_PER_DAY = 1440;

/** Post-filtered (per fetched page) predicates — no index can answer these. */
export const needsPostFilter = (filter: ShopFilterState): boolean =>
  !!filter.hours?.openNow || !!filter.activity;

export const describeShopSearchStrategy = (
  filter: ShopFilterState,
  q: string
): ShopSearchStrategy => {
  if (!q.trim()) return 'mongo';
  // The name constraint, any hours predicate (time-dependent open-now, or
  // shop-local schedule requirements that `openingMinutes` answers exactly in
  // Mongo), geo, and Redis-derived activity all leave the Meili path.
  if (
    needsPostFilter(filter) ||
    filter.geo ||
    filter.name ||
    (filter.hours && Object.keys(filter.hours).length > 0)
  ) {
    return 'mongo-text';
  }
  return 'meili';
};

// ── MongoDB filter builder ──────────────────────────────────────────────────

const hourElemMatch = (day: number, condition: Record<string, unknown>): Filter<Shop> =>
  ({ [`openingMinutes.${day}`]: { $elemMatch: condition } }) as Filter<Shop>;

const daysWithQuantifier = (
  spec: { set: number[]; quantifier?: 'any' | 'all' },
  buildForDay: (day: number) => Filter<Shop>
): Filter<Shop> =>
  spec.quantifier === 'all'
    ? ({ $and: spec.set.map(buildForDay) } as Filter<Shop>)
    : ({ $or: spec.set.map(buildForDay) } as Filter<Shop>);

const minutesRange = (range?: { min?: number; max?: number }): Record<string, number> => {
  const condition: Record<string, number> = {};
  if (range?.min !== undefined) condition.$gte = range.min;
  if (range?.max !== undefined) condition.$lte = range.max;
  return condition;
};

const gameLeafToMongo = (leaf: ShopFilterGameLeaf): Filter<Shop> => {
  // Title-only leaves are semantically identical against raw entries and the
  // aggregated cache (any entry with the title ⟺ the aggregated title
  // exists), so they skip the cache dependency entirely. Leaves carrying a
  // quantity range must evaluate per aggregated title — that is what
  // `aggGames` holds.
  if (leaf.titleIds && leaf.quantity) {
    const condition: Record<string, unknown> = { titleId: { $in: leaf.titleIds } };
    const quantity = minutesRange(leaf.quantity);
    if (Object.keys(quantity).length > 0) condition.quantity = quantity;
    return { aggGames: { $elemMatch: condition } } as Filter<Shop>;
  }
  if (leaf.titleIds) {
    return { 'games.titleId': { $in: leaf.titleIds } } as Filter<Shop>;
  }
  const quantity = minutesRange(leaf.quantity);
  if (Object.keys(quantity).length > 0) {
    return { aggGames: { $elemMatch: { quantity } } } as Filter<Shop>;
  }
  return {};
};

const gameExprToMongo = (expr: ShopFilterGameExpr): Filter<Shop> => {
  const parts = expr.children.map((child) =>
    'op' in child ? gameExprToMongo(child) : gameLeafToMongo(child)
  );
  return (expr.op === 'and' ? { $and: parts } : { $or: parts }) as Filter<Shop>;
};

/** Exact `min ≤ value ≤ max` on a computed value via `$expr`. */
const numericExprFilter = (
  valueExpression: Record<string, unknown>,
  range: { min?: number; max?: number } | undefined
): Filter<Shop> | null => {
  if (!range) return null;
  const comparisons: Record<string, unknown>[] = [];
  if (range.min !== undefined) comparisons.push({ $gte: [valueExpression, range.min] });
  if (range.max !== undefined) comparisons.push({ $lte: [valueExpression, range.max] });
  if (comparisons.length === 0) return null;
  return {
    $expr: comparisons.length === 1 ? comparisons[0] : { $and: comparisons }
  } as Filter<Shop>;
};

const toDateOrUndefined = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const hoursToMongo = (hours: NonNullable<ShopFilterState['hours']>): Filter<Shop> | null => {
  const parts: Filter<Shop>[] = [];

  if (hours.openAt) {
    const { minute } = hours.openAt;
    parts.push(
      daysWithQuantifier(hours.openAt.days, (day) => ({
        $or: [
          hourElemMatch(day, { o: { $lte: minute }, c: { $gt: minute } }),
          // Overnight spill: yesterday's interval covers today's early morning.
          ...(minute < MINUTES_PER_DAY
            ? [hourElemMatch((day + 6) % 7, { c: { $gt: minute + MINUTES_PER_DAY } })]
            : [])
        ]
      }))
    );
  }
  if (hours.closesFrom) {
    const { minute } = hours.closesFrom;
    parts.push(
      daysWithQuantifier(hours.closesFrom.days, (day) => ({
        $or: [
          hourElemMatch(day, { c: { $gte: minute } }),
          ...(minute < MINUTES_PER_DAY
            ? [hourElemMatch((day + 6) % 7, { c: { $gte: minute + MINUTES_PER_DAY } })]
            : [])
        ]
      }))
    );
  }
  if (hours.opensBy) {
    const { minute } = hours.opensBy;
    parts.push(
      daysWithQuantifier(hours.opensBy.days, (day) => hourElemMatch(day, { o: { $lte: minute } }))
    );
  }
  if (hours.is24h) {
    parts.push({
      $and: Array.from({ length: 7 }, (_, day) =>
        hourElemMatch(day, { o: 0, c: { $gte: MINUTES_PER_DAY } })
      )
    } as Filter<Shop>);
  }
  if (hours.weekly?.minOpenDays !== undefined) {
    parts.push({
      $expr: {
        $gte: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ['$openingMinutes', []] },
                cond: { $gt: [{ $size: '$$this' }, 0] }
              }
            }
          },
          hours.weekly.minOpenDays
        ]
      }
    } as Filter<Shop>);
  }
  if (hours.weekly?.minOpenMinutes !== undefined) {
    parts.push({
      $expr: {
        $gte: [
          {
            $reduce: {
              input: { $ifNull: ['$openingMinutes', []] },
              initialValue: 0,
              in: {
                $add: [
                  '$$value',
                  {
                    $sum: {
                      $map: {
                        input: '$$this',
                        as: 'interval',
                        in: { $max: [0, { $subtract: ['$$interval.c', '$$interval.o'] }] }
                      }
                    }
                  }
                ]
              }
            }
          },
          hours.weekly.minOpenMinutes
        ]
      }
    } as Filter<Shop>);
  }
  // `openNow` is time-dependent and per-shop-timezone: it cannot be a Mongo
  // predicate. The engine narrows with a superset (isClosed ≠ true) and
  // post-filters exactly per page (`isShopOpenAt`).
  return parts.length > 0 ? ({ $and: parts } as Filter<Shop>) : null;
};

/**
 * Name constraint → Mongo predicate on the `name` field only. Case-
 * insensitive; `contains` is a substring match, `exact` a whole-name
 * equality. The value is regex-escaped, never treated as a pattern.
 */
const nameToMongo = (name: NonNullable<ShopFilterState['name']>): Filter<Shop> => {
  const escaped = escapeForRegExp(name.value);
  const regex =
    name.mode === 'exact' ? `^${escaped}$` : escaped;
  return { name: { $regex: regex, $options: 'i' } } as Filter<Shop>;
};

/**
 * Build the exact MongoDB filter for everything except geo (applied via
 * `$geoNear` when fetching, and via `buildShopMongoCountFilter` when counting),
 * open-now superset narrowing, and activity post-filtering.
 */
export const buildShopMongoFilter = (filter: ShopFilterState): Filter<Shop> => {
  const parts: Filter<Shop>[] = [];

  if (filter.regions?.length) {
    parts.push({ 'address.region': { $in: filter.regions } } as Filter<Shop>);
  }
  if (filter.name) {
    parts.push(nameToMongo(filter.name));
  }
  if (filter.games) {
    parts.push(gameExprToMongo(filter.games));
  }
  const machineCountFilter = numericExprFilter(
    { $sum: '$games.quantity' },
    filter.machines?.machineCount
  );
  if (machineCountFilter) parts.push(machineCountFilter);
  const distinctTitlesFilter = numericExprFilter(
    { $size: { $setUnion: [{ $map: { input: '$games', as: 'game', in: '$$game.titleId' } }, []] } },
    filter.machines?.distinctTitles
  );
  if (distinctTitlesFilter) parts.push(distinctTitlesFilter);

  const hoursFilter = filter.hours ? hoursToMongo(filter.hours) : null;
  if (hoursFilter) parts.push(hoursFilter);
  if (filter.status?.closed === 'only') {
    parts.push({ isClosed: true } as Filter<Shop>);
  } else if (filter.status?.closed === 'exclude' || filter.hours?.openNow) {
    parts.push({ isClosed: { $ne: true } } as Filter<Shop>);
  }
  if (filter.advanced?.claim === 'claimed') {
    parts.push({ isClaimed: true } as Filter<Shop>);
  } else if (filter.advanced?.claim === 'unclaimed') {
    parts.push({ isClaimed: { $ne: true } } as Filter<Shop>);
  }
  const createdAtRange: Record<string, Date> = {};
  const createdAfter = toDateOrUndefined(filter.advanced?.createdAfter);
  const createdBefore = toDateOrUndefined(filter.advanced?.createdBefore);
  if (createdAfter) createdAtRange.$gte = createdAfter;
  if (createdBefore) createdAtRange.$lte = createdBefore;
  if (Object.keys(createdAtRange).length > 0) {
    parts.push({ createdAt: createdAtRange } as Filter<Shop>);
  }
  const updatedAtRange: Record<string, Date> = {};
  const updatedAfter = toDateOrUndefined(filter.advanced?.updatedAfter);
  const updatedBefore = toDateOrUndefined(filter.advanced?.updatedBefore);
  if (updatedAfter) updatedAtRange.$gte = updatedAfter;
  if (updatedBefore) updatedAtRange.$lte = updatedBefore;
  if (Object.keys(updatedAtRange).length > 0) {
    parts.push({ updatedAt: updatedAtRange } as Filter<Shop>);
  }

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts } as Filter<Shop>;
};

export const buildTextCondition = (q: string): Filter<Shop> => {
  const pattern = buildSearchPattern(q);
  return {
    $or: [
      { name: { $regex: pattern, $options: 'is' } },
      { 'address.general': { $elemMatch: { $regex: pattern, $options: 'is' } } },
      { 'address.detailed': { $regex: pattern, $options: 'is' } },
      { 'games.name': { $regex: pattern, $options: 'is' } },
      { 'games.version': { $regex: pattern, $options: 'is' } },
      { comment: { $regex: pattern, $options: 'is' } }
    ]
  } as Filter<Shop>;
};

/**
 * `$centerSphere` takes radians on a sphere of this radius — the same constant
 * MongoDB's own `$centerSphere` documentation uses, and the one `$geoNear`
 * assumes for `spherical: true` distances, so the two agree.
 */
export const EARTH_RADIUS_KM = 6378.1;

/**
 * Combine predicates into one flat filter.
 *
 * Empty predicates are dropped (they constrain nothing) and nested `$and` groups
 * are spliced in, so combining a combined filter never produces `{ $and: [{ $and:
 * [...] }, x] }` — the same predicate always serializes to the same shape.
 */
export const combineMongoFilters = (...filters: Array<Filter<Shop> | null>): Filter<Shop> => {
  const parts: Filter<Shop>[] = [];
  for (const filter of filters) {
    if (filter == null) continue;
    const keys = Object.keys(filter);
    if (keys.length === 0) continue;
    if (keys.length === 1 && keys[0] === '$and' && Array.isArray(filter.$and)) {
      for (const part of filter.$and as Filter<Shop>[]) {
        if (part != null && Object.keys(part).length > 0) parts.push(part);
      }
      continue;
    }
    parts.push(filter);
  }
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts } as Filter<Shop>;
};

/**
 * The geo radius as a plain predicate, in the `$geoWithin` shape.
 *
 * The paged fetch restricts by `$geoNear` (it must, to order by distance), which
 * cannot be expressed as a query filter — so the total must apply the same radius
 * some other way. `$geoWithin`/`$centerSphere` measures the same great-circle
 * distance on the same 2dsphere index, and unlike `$geoNear` it composes with
 * `countDocuments`, so a geo filter can never widen the reported total.
 */
export const buildShopGeoFilter = (filter: ShopFilterState): Filter<Shop> | null => {
  const geo = filter.geo;
  if (!geo) return null;
  return {
    location: {
      $geoWithin: { $centerSphere: [[geo.lng, geo.lat], geo.radiusKm / EARTH_RADIUS_KM] }
    }
  } as Filter<Shop>;
};

/**
 * Everything the engine can express as a plain predicate: the filter minus the
 * geo radius, plus the free-text query when there is one. Used for `find`, for a
 * `$match` stage, and as the `$geoNear.query` of the geo pipeline, so no Mongo
 * path can silently drop the search text.
 */
export const buildShopMongoPredicate = (filter: ShopFilterState, q = ''): Filter<Shop> =>
  combineMongoFilters(buildShopMongoFilter(filter), q.trim() ? buildTextCondition(q) : null);

/**
 * The predicate behind the reported total. Must always be the fetch predicate
 * *plus* the geo radius — anything less reports a total wider than the page the
 * user actually sees.
 */
export const buildShopMongoCountFilter = (filter: ShopFilterState, q = ''): Filter<Shop> =>
  combineMongoFilters(buildShopMongoPredicate(filter, q), buildShopGeoFilter(filter));

// ── Meilisearch filter builder ──────────────────────────────────────────────

const escapeMeiliValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const gameLeafToMeili = (leaf: ShopFilterGameLeaf): string | null => {
  if (leaf.titleIds && leaf.quantity) {
    // Compound leaf: Meili AND is cross-object, so use the per-entry tokens.
    // A token `t{id}q{n}` exists for every aggregated quantity 0..n, meaning
    // "this title is present with at least n machines"; enumerating the range
    // restores exact per-entry semantics. Guard against pathological sizes —
    // the caller falls back to the Mongo text path instead of approximating.
    const lo = leaf.quantity.min ?? 0;
    const hi = Math.min(leaf.quantity.max ?? GAME_TOKEN_QUANTITY_CAP, GAME_TOKEN_QUANTITY_CAP);
    const tokens: string[] = [];
    for (const titleId of leaf.titleIds) {
      for (let quantity = lo; quantity <= hi; quantity++) tokens.push(`t${titleId}q${quantity}`);
    }
    if (tokens.length > 256) return null;
    return `gameTokens IN [${tokens.join(', ')}]`;
  }
  if (leaf.titleIds) {
    return `games.titleId IN [${leaf.titleIds.join(', ')}]`;
  }
  if (leaf.quantity) {
    // A single-field condition is per-entry by definition — no cross-object
    // ambiguity for a quantity-only requirement.
    const conditions: string[] = [];
    if (leaf.quantity.min !== undefined) conditions.push(`games.quantity >= ${leaf.quantity.min}`);
    if (leaf.quantity.max !== undefined) conditions.push(`games.quantity <= ${leaf.quantity.max}`);
    return conditions.join(' AND ');
  }
  return null;
};

const gameExprToMeili = (expr: ShopFilterGameExpr): string | null => {
  const parts = expr.children.map((child) =>
    'op' in child ? gameExprToMeili(child) : gameLeafToMeili(child)
  );
  if (parts.some((part) => part === null)) return null;
  const nonEmpty = parts.filter((part): part is string => part !== null && part.length > 0);
  if (nonEmpty.length === 0) return '';
  if (nonEmpty.length === 1) return nonEmpty[0];
  return `(${nonEmpty.join(expr.op === 'and' ? ' AND ' : ' OR ')})`;
};

/**
 * Build the Meilisearch filter expression, or `null` when any active filter
 * is not index-expressible (the caller must switch strategy). An empty
 * string means "no filter needed".
 */
export const buildShopMeiliFilter = (filter: ShopFilterState): string | null => {
  // Defense in depth: these are routed to a Mongo strategy by
  // `describeShopSearchStrategy`; refuse them here too so a direct call can
  // never silently drop a predicate.
  if (
    filter.name ||
    filter.geo ||
    filter.activity ||
    (filter.hours && Object.keys(filter.hours).length > 0)
  ) {
    return null;
  }

  const parts: string[] = [];

  if (filter.regions?.length) {
    parts.push(
      `(${filter.regions
        .map((region) => `address.region = "${escapeMeiliValue(region)}"`)
        .join(' OR ')})`
    );
  }
  if (filter.games) {
    const games = gameExprToMeili(filter.games);
    if (games === null) return null;
    if (games.length > 0) parts.push(games);
  }
  if (filter.machines?.machineCount) {
    if (filter.machines.machineCount.min !== undefined) {
      parts.push(`stats.machineCount >= ${filter.machines.machineCount.min}`);
    }
    if (filter.machines.machineCount.max !== undefined) {
      parts.push(`stats.machineCount <= ${filter.machines.machineCount.max}`);
    }
  }
  if (filter.machines?.distinctTitles) {
    if (filter.machines.distinctTitles.min !== undefined) {
      parts.push(`stats.distinctTitleCount >= ${filter.machines.distinctTitles.min}`);
    }
    if (filter.machines.distinctTitles.max !== undefined) {
      parts.push(`stats.distinctTitleCount <= ${filter.machines.distinctTitles.max}`);
    }
  }
  if (filter.status?.closed === 'only') parts.push('isClosed = true');
  if (filter.status?.closed === 'exclude') parts.push('isClosed = false');
  if (filter.advanced?.claim === 'claimed') parts.push('isClaimed = true');
  if (filter.advanced?.claim === 'unclaimed') parts.push('isClaimed = false');
  const createdAtAfter = toDateOrUndefined(filter.advanced?.createdAfter);
  const createdAtBefore = toDateOrUndefined(filter.advanced?.createdBefore);
  if (createdAtAfter) parts.push(`createdAt >= ${createdAtAfter.toISOString()}`);
  if (createdAtBefore) parts.push(`createdAt <= ${createdAtBefore.toISOString()}`);
  const updatedAtAfter = toDateOrUndefined(filter.advanced?.updatedAfter);
  const updatedAtBefore = toDateOrUndefined(filter.advanced?.updatedBefore);
  if (updatedAtAfter) parts.push(`updatedAt >= ${updatedAtAfter.toISOString()}`);
  if (updatedAtBefore) parts.push(`updatedAt <= ${updatedAtBefore.toISOString()}`);

  return parts.join(' AND ');
};

export const MEILI_SORTS: Partial<Record<ShopSearchSort, string>> = {
  name_asc: 'name:asc',
  name_desc: 'name:desc',
  machines_desc: 'stats.machineCount:desc',
  machines_asc: 'stats.machineCount:asc',
  titles_desc: 'stats.distinctTitleCount:desc',
  attendance_desc: 'stats.currentAttendance:desc',
  id_asc: 'id:asc',
  id_desc: 'id:desc',
  updated_desc: 'updatedAt:desc',
  created_desc: 'createdAt:desc'
};

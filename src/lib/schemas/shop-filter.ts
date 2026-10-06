import { z } from 'zod';

import { bilingual } from './common';

/**
 * Canonical shop filter state, shared by the shop list page, the globe, and
 * (later) the REST endpoints. The whole state minus `q`/`sort`/`page`
 * serializes into a single URL parameter (`f`, base64url JSON, see
 * `src/lib/utils/shops/filter.ts`).
 *
 * `name` is the exact, name-scoped counterpart of the fuzzy `q` full-text
 * search: it constrains only the shop name (case-insensitive substring or
 * whole-name equality) and never touches addresses, games, comments or region
 * names, so callers that already know the name can get an exact result set.
 * It routes the query to the Mongo strategy — see
 * `describeShopSearchStrategy`.
 *
 * Game filter semantics: a leaf is ONE requirement on a SINGLE game entry —
 * `titleIds` is an IN-set and `quantity` a range evaluated against the
 * per-title aggregated machine count (two qty-1 maimai entries count as 2).
 * A shop matches a leaf iff at least one (aggregated) entry satisfies all of
 * its fields; groups combine children with AND/OR. This leaf model is what
 * makes the expression exactly translatable to MongoDB (`$elemMatch`) and to
 * Meilisearch (per-entry `gameTokens`, see `computeGameTokens`).
 *
 * Weekday convention — one standard across the whole app: values are
 * MONDAY-FIRST (`0 = Monday … 6 = Sunday`), matching the `openingHours`
 * rows authored via the edit form. Minutes are shop-local and may be
 * extended (`1500` = 25:00) for late-night requirements.
 */

export const SHOP_FILTER_VERSION = 1;
export const SHOP_FILTER_MAX_REGIONS = 10;
export const SHOP_FILTER_MAX_DEPTH = 3;
// Bounds the URL parameter is validated against. They are part of the wire
// contract (a client sends them), not of the UI, so they stay module-private.
const SHOP_FILTER_MAX_TITLES = 50;
const SHOP_FILTER_MAX_NAME_LENGTH = 64;
const SHOP_FILTER_MAX_LEAVES = 32;
const SHOP_FILTER_MAX_MINUTE = 47 * 60 + 59; // 47:59 — matches the schema's close-hour bound

const rangeSchema = (description: { zh: string; en: string }) =>
  z
    .object({
      min: z.int().min(0).optional(),
      max: z.int().min(0).optional()
    })
    .refine(
      (value) => value.min === undefined || value.max === undefined || value.min <= value.max,
      {
        message: 'min must be ≤ max'
      }
    )
    .describe(bilingual(description.zh, description.en));

const daySpecSchema = z
  .object({
    set: z.array(z.int().min(0).max(6)).min(1).max(7),
    quantifier: z.enum(['any', 'all']).optional()
  })
  .describe(
    bilingual(
      '星期集合（周一为 0，依次到周日为 6）及量词：any 表示任一天满足，all 表示每天都满足。',
      'Weekday set (Monday-first, 0 = Monday … 6 = Sunday) and quantifier: any = at least one day, all = every day.'
    )
  );

const minutesOfDaySchema = (description: { zh: string; en: string }) =>
  z.int().min(0).max(SHOP_FILTER_MAX_MINUTE).describe(bilingual(description.zh, description.en));

const shopOpeningHourPairSchema = z.object({
  openAt: z
    .object({
      days: daySpecSchema,
      minute: minutesOfDaySchema({ zh: '时刻（店铺本地）。', en: 'Minute of day (shop-local).' })
    })
    .optional(),
  opensBy: z
    .object({
      days: daySpecSchema,
      minute: minutesOfDaySchema({ zh: '时刻（店铺本地）。', en: 'Minute of day (shop-local).' })
    })
    .optional(),
  closesFrom: z
    .object({
      days: daySpecSchema,
      minute: minutesOfDaySchema({ zh: '时刻（店铺本地）。', en: 'Minute of day (shop-local).' })
    })
    .optional()
});

const gameLeafSchema = z
  .object({
    titleIds: z.array(z.int()).min(1).max(SHOP_FILTER_MAX_TITLES).optional(),
    quantity: rangeSchema({ zh: '机台数量范围。', en: 'Machine quantity range.' }).optional()
  })
  .refine((leaf) => leaf.titleIds !== undefined || leaf.quantity !== undefined, {
    message: 'A game requirement must set titleIds, quantity, or both'
  });

export type ShopFilterGameLeaf = z.infer<typeof gameLeafSchema>;

export type ShopFilterGameExpr = {
  op: 'and' | 'or';
  children: Array<ShopFilterGameLeaf | ShopFilterGameExpr>;
};

const gameExprSchema: z.ZodType<ShopFilterGameExpr> = z.lazy(() =>
  z.object({
    op: z.enum(['and', 'or']),
    children: z
      .array(z.union([gameLeafSchema, gameExprSchema]))
      .min(1)
      .max(SHOP_FILTER_MAX_LEAVES)
  })
);

const shopFilterStateObjectSchema = z
  .object({
    v: z.literal(SHOP_FILTER_VERSION),
    regions: z
      .array(z.string().min(1))
      .min(1)
      .max(SHOP_FILTER_MAX_REGIONS)
      .optional()
      .describe(
        bilingual(
          '地区节点 ID（任意层级，OR 语义）。',
          'Region node IDs (any hierarchy level, OR semantics).'
        )
      ),
    name: z
      .object({
        value: z.string().min(1).max(SHOP_FILTER_MAX_NAME_LENGTH),
        mode: z.enum(['contains', 'exact']).default('contains')
      })
      .optional()
      .describe(
        bilingual(
          '机厅名称匹配（大小写不敏感；contains 为子串匹配，exact 为全等匹配）。与 q 的模糊全文检索无关，仅在 name 字段上精确生效。',
          'Shop name match (case-insensitive; contains = substring, exact = whole-name equality). Independent of the fuzzy full-text q parameter; applies exactly to the name field.'
        )
      ),
    geo: z
      .object({
        mode: z.literal('near'),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radiusKm: z.number().positive().max(100)
      })
      .optional()
      .describe(bilingual('就近搜索（经纬度 + 半径）。', 'Nearby search (point + radius).')),
    games: gameExprSchema
      .optional()
      .describe(bilingual('游戏机台需求表达式。', 'Game machine requirement expression.')),
    machines: z
      .object({
        machineCount: rangeSchema({
          zh: '机台总数范围。',
          en: 'Total machine count range.'
        }).optional(),
        distinctTitles: rangeSchema({
          zh: '不同游戏系列数范围。',
          en: 'Distinct title count range.'
        }).optional()
      })
      .optional(),
    hours: shopOpeningHourPairSchema
      .extend({
        openNow: z.boolean().optional(),
        weekly: z
          .object({
            minOpenDays: z.int().min(1).max(7).optional(),
            minOpenMinutes: z.int().min(1).optional()
          })
          .optional(),
        is24h: z.boolean().optional()
      })
      .optional(),
    status: z
      .object({
        closed: z.enum(['include', 'exclude', 'only']).optional()
      })
      .optional(),
    activity: z
      .object({
        attendance: rangeSchema({
          zh: '当前在勤人数范围。',
          en: 'Current attendance range.'
        }).optional(),
        gameAttendance: z
          .array(
            z.object({
              titleIds: z.array(z.int()).min(1).max(SHOP_FILTER_MAX_TITLES),
              min: z.int().min(0).optional(),
              max: z.int().min(0).optional()
            })
          )
          .min(1)
          .max(SHOP_FILTER_MAX_LEAVES)
          .optional()
      })
      .optional(),
    advanced: z
      .object({
        claim: z.enum(['any', 'claimed', 'unclaimed']).optional(),
        createdAfter: z.string().optional(),
        createdBefore: z.string().optional(),
        updatedAfter: z.string().optional(),
        updatedBefore: z.string().optional()
      })
      .optional()
  })
  .superRefine((state, ctx) => {
    const checkDepth = (expr: ShopFilterGameExpr, depth: number) => {
      if (depth > SHOP_FILTER_MAX_DEPTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['games'],
          message: `Game expression exceeds max depth ${SHOP_FILTER_MAX_DEPTH}`
        });
        return;
      }
      for (const child of expr.children) {
        if ('op' in child) checkDepth(child, depth + 1);
      }
    };
    if (state.games) checkDepth(state.games, 1);
  });

export type ShopFilterState = z.output<typeof shopFilterStateObjectSchema>;

const ADVANCED_DATE_KEYS = [
  'createdAfter',
  'createdBefore',
  'updatedAfter',
  'updatedBefore'
] as const;
const SCHEDULE_KEYS = ['openAt', 'opensBy', 'closesFrom'] as const;

/** `new Date()` accepts plenty of junk; the builders drop anything unparseable. */
const isUsableDate = (value: string | undefined): value is string =>
  !!value && !Number.isNaN(new Date(value).getTime());

const normalizeGameLeaf = (leaf: ShopFilterGameLeaf): ShopFilterGameLeaf | null => {
  const titleIds = leaf.titleIds ?? [];
  const quantity = leaf.quantity;
  const hasQuantity = !!quantity && (quantity.min !== undefined || quantity.max !== undefined);
  if (titleIds.length === 0 && !hasQuantity) return null;
  return {
    ...(titleIds.length > 0 ? { titleIds: [...titleIds] } : {}),
    ...(hasQuantity && quantity ? { quantity: { ...quantity } } : {})
  };
};

const normalizeGameNode = (
  node: ShopFilterGameLeaf | ShopFilterGameExpr
): ShopFilterGameLeaf | ShopFilterGameExpr | null => {
  if (!('op' in node)) return normalizeGameLeaf(node);
  const children = node.children
    .map(normalizeGameNode)
    .filter((child): child is ShopFilterGameLeaf | ShopFilterGameExpr => child !== null);
  if (children.length === 0) return null;
  return { op: node.op, children };
};

/**
 * Drop everything the query builders ignore anyway, so the "N active filters"
 * badge, the serialized URL and the actual result set always agree.
 *
 * Neither `buildShopMongoFilter` nor `buildShopMeiliFilter` acts on
 * `status.closed = 'include'` or `advanced.claim = 'any'`; a `false` hours flag,
 * an empty `weekly` object, a date bound that does not parse, a schedule row
 * without weekdays, a name value that is empty after trimming and a game leaf
 * without titles or quantity are all no-ops
 * too. The panel deliberately keeps partially-filled rows while the user works,
 * and a hand-edited or pre-normalization URL can carry the same shapes — left
 * alone they would be reported as phantom "active" filters and would serialize
 * into a redundant `f` parameter. Idempotent, and never rejects anything.
 */
export const normalizeShopFilterState = (state: ShopFilterState): ShopFilterState => {
  const cleaned: ShopFilterState = { v: state.v };
  if (state.regions?.length) cleaned.regions = [...state.regions];
  if (state.name) {
    const value = state.name.value.trim();
    if (value) cleaned.name = { value, mode: state.name.mode };
  }
  if (state.geo) cleaned.geo = { ...state.geo };
  if (state.games) {
    const games = normalizeGameNode(state.games);
    if (games && 'op' in games) cleaned.games = games;
  }
  if (state.machines && Object.keys(state.machines).length > 0) cleaned.machines = state.machines;
  if (state.hours) {
    const hours = { ...state.hours };
    for (const key of SCHEDULE_KEYS) {
      // A schedule row needs at least one weekday before it can match anything.
      if (hours[key] && hours[key].days.set.length === 0) delete hours[key];
    }
    if (hours.openNow === false) delete hours.openNow;
    if (hours.is24h === false) delete hours.is24h;
    if (hours.weekly && Object.keys(hours.weekly).length === 0) delete hours.weekly;
    if (Object.keys(hours).length > 0) cleaned.hours = hours;
  }
  if (state.status?.closed && state.status.closed !== 'include') {
    cleaned.status = { closed: state.status.closed };
  }
  if (state.activity && Object.keys(state.activity).length > 0) cleaned.activity = state.activity;
  if (state.advanced) {
    const advanced: NonNullable<ShopFilterState['advanced']> = {};
    if (state.advanced.claim && state.advanced.claim !== 'any') {
      advanced.claim = state.advanced.claim;
    }
    for (const key of ADVANCED_DATE_KEYS) {
      const value = state.advanced[key];
      if (isUsableDate(value)) advanced[key] = value;
    }
    if (Object.keys(advanced).length > 0) cleaned.advanced = advanced;
  }
  return cleaned;
};

export const shopFilterStateSchema =
  shopFilterStateObjectSchema.transform(normalizeShopFilterState);

export const SHOP_SORT_OPTIONS = [
  'relevance',
  'name_asc',
  'name_desc',
  'distance',
  'machines_desc',
  'machines_asc',
  'titles_desc',
  'attendance_desc',
  'id_asc',
  'id_desc',
  'updated_desc',
  'created_desc'
] as const;

export type ShopSearchSort = (typeof SHOP_SORT_OPTIONS)[number];

export const shopSearchSortSchema = z.enum(SHOP_SORT_OPTIONS);

/** A fresh filter with everything at its default. */
export const emptyShopFilterState = (): ShopFilterState => ({ v: SHOP_FILTER_VERSION });

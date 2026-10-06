/**
 * The shop filter's URL contract — the half every surface shares.
 *
 * Contract on both the shop list page and the globe:
 *   - `q`    — free-text query (also pins an exact shop when purely numeric)
 *   - `sort` — one of SHOP_SORT_OPTIONS
 *   - `page` — pagination
 *   - `f`    — base64url(JSON) of the whole `ShopFilterState` (`v:1` inside)
 *
 * Legacy parameters (`titleIds`, `regionId`, and the globe's `region`) from the
 * pre-filter URLs are mapped into the state when `f` is absent or alongside it,
 * so old links and bookmarks keep working. The app itself always writes `f`
 * going forward.
 *
 * WHY THIS IS ITS OWN MODULE — it is the only half of the filter that runs in
 * the browser. Six components (the filter panel, the globe, the admin region
 * tree, and three page components) read and write the URL through here, while
 * the query builders in `filter-query.server.ts` have exactly three callers and
 * all of them are on the server. Folding the two together would put the Mongo
 * and Meilisearch translation in front of every one of those components, so the
 * split is load-bearing rather than stylistic: this file imports nothing that
 * cannot run on the client, which is what keeps it that way.
 */
import {
  SHOP_FILTER_VERSION,
  emptyShopFilterState,
  normalizeShopFilterState,
  shopFilterStateSchema,
  shopSearchSortSchema,
  type ShopFilterGameExpr,
  type ShopFilterState,
  type ShopSearchSort
} from '$lib/schemas/shop-filter';

const encodeBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const decodeBase64Url = (value: string): string => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/** Serialize the filter state to the value of the `f` URL parameter. */
export const serializeShopFilterState = (state: ShopFilterState): string =>
  encodeBase64Url(JSON.stringify(state));

/**
 * Parse the `f` URL parameter. Returns `null` when absent or invalid —
 * callers treat that as "no filter" instead of erroring, so hand-edited URLs
 * degrade gracefully.
 */
export const parseShopFilterParam = (raw: string | null | undefined): ShopFilterState | null => {
  if (!raw) return null;
  try {
    const parsed = shopFilterStateSchema.safeParse(JSON.parse(decodeBase64Url(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/**
 * The filter state without its geo radius.
 *
 * Discover owns its own origin and radius (`longitude`/`latitude`/`radius`),
 * which also drive metro routing — so a geo constraint inside the structured
 * filter there would be a second, conflicting source of distance truth. The
 * discover surface therefore drops it rather than honouring half of it, and the
 * panel hides the control so it never appears to be doing anything.
 *
 * Applied on both sides of the wire (client draft and server parse) so the
 * active-filter count can never advertise a radius the query ignores.
 */
export const withoutGeoFilter = (state: ShopFilterState): ShopFilterState => {
  if (!state.geo) return state;
  const rest = { ...state };
  delete rest.geo;
  return rest;
};

/** Map legacy `titleIds` (CSV, AND semantics) into a game expression. */
const legacyTitleIdsToGames = (raw: string | null): ShopFilterGameExpr | null => {
  if (!raw) return null;
  const titleIds = raw
    .split(',')
    .map((id) => Number.parseInt(id.trim(), 10))
    .filter((id) => Number.isInteger(id) && id >= 0);
  if (titleIds.length === 0) return null;
  return {
    op: 'and',
    children: titleIds.map((titleId) => ({ titleIds: [titleId] }))
  };
};

/**
 * Read the filter state from URL search params, mapping legacy
 * `titleIds`/`regionId` when `f` is not present.
 */
export const readShopFilterState = (searchParams: URLSearchParams): ShopFilterState => {
  const fromParam = parseShopFilterParam(searchParams.get('f'));
  if (fromParam) return fromParam;

  const state = emptyShopFilterState();
  const legacyGames = legacyTitleIdsToGames(searchParams.get('titleIds'));
  const legacyRegionId = searchParams.get('regionId');
  if (legacyGames) state.games = legacyGames;
  if (legacyRegionId) state.regions = [legacyRegionId];
  return state;
};

/** The leaf ID of a legacy drill-link chain, or `null` if `value` isn't one. */
const decodeLegacyChainLeaf = (value: string): string | null => {
  try {
    const chain: unknown = JSON.parse(decodeURIComponent(atob(value)));
    if (!Array.isArray(chain)) return null;
    const leaf = chain[chain.length - 1] as { id?: unknown } | undefined;
    return typeof leaf?.id === 'string' && leaf.id ? leaf.id : null;
  } catch {
    return null;
  }
};

/**
 * Decode the globe's legacy `region` parameter to a region ID.
 *
 * It has carried two shapes over time: a bare region ID on API requests, and
 * `base64(encodeURIComponent(JSON(chain)))` on drill links, where `chain` holds
 * `{ id, name: Record<locale, string> }` for the whole hierarchy. Only the leaf
 * ID survives — names are resolved from the region hierarchy at read time, so a
 * link no longer has to carry them, and a region reached through one renders in
 * the reader's language rather than the language it was shared in.
 */
export const parseLegacyRegionId = (raw: string | null | undefined): string | null => {
  const value = raw?.trim();
  if (!value) return null;
  // The chain is tried FIRST. A bare ID is a substring of the base64 alphabet,
  // so guessing "short and URL-safe ⇒ bare ID" can swallow a real chain whose
  // base64 happens to come out all-alphanumeric; the reverse mistake is
  // impossible, because an ID is not a JSON array.
  const leafId = decodeLegacyChainLeaf(value);
  if (leafId) return leafId;
  return /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : null;
};

/**
 * The globe's filter state from a request URL.
 *
 * The globe used to carry its region as a parameter of its own, next to `f` and
 * translated into a separate constraint on the server. Both spellings now mean
 * the same thing as a region chip in the structured filter, so they are folded
 * into `regions` here and every consumer — page load, sidebar query, marker
 * highlight — sees exactly one state.
 */
export const readGlobeFilterState = (
  searchParams: URLSearchParams
): ShopFilterState | undefined => {
  const state = parseShopFilterParam(searchParams.get('f'));
  const legacyRegionId = parseLegacyRegionId(searchParams.get('region'));
  if (!legacyRegionId) return state ?? undefined;

  const regions = state?.regions ?? [];
  if (regions.includes(legacyRegionId)) return state ?? undefined;
  return { ...(state ?? emptyShopFilterState()), regions: [...regions, legacyRegionId] };
};

export interface ShopPageQuery {
  q: string;
  sort: ShopSearchSort;
  page: number;
  filter: ShopFilterState;
}

/**
 * Read the full page query (`q`/`sort`/`page`/`f` plus legacy params) from
 * URL search params. Invalid sort values fall back to the default.
 */
export const readShopPageQuery = (searchParams: URLSearchParams): ShopPageQuery => {
  const q = searchParams.get('q') ?? '';
  const sortResult = shopSearchSortSchema.safeParse(searchParams.get('sort'));
  const sort: ShopSearchSort = sortResult.success ? sortResult.data : 'relevance';
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  return {
    q,
    sort: sort === 'relevance' && !q.trim() ? 'id_asc' : sort,
    page,
    filter: readShopFilterState(searchParams)
  };
};

/**
 * Build URL search params from a page query. An all-default filter omits `f`
 * entirely so plain links stay clean.
 */
export const writeShopPageQuery = ({ q, sort, page, filter }: ShopPageQuery): URLSearchParams => {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q);
  if (sort !== 'relevance') params.set('sort', sort);
  if (page > 1) params.set('page', String(page));
  // An all-default filter omits `f` entirely so plain links stay clean.
  if (serializeShopFilterState(filter) !== serializeShopFilterState(emptyShopFilterState())) {
    params.set('f', serializeShopFilterState(filter));
  }
  return params;
};

/**
 * Number of active filter dimensions, for the panel badge.
 *
 * Counts what will actually reach the query builders, so the badge matches the
 * filter that gets applied even while the user is halfway through a row. It
 * runs on the raw panel draft, not on the serialized state, so the count can
 * lead the URL by one step — but never the other way round.
 */
export const countActiveFilters = (state: ShopFilterState): number => {
  const normalized = normalizeShopFilterState(state);
  let count = 0;
  if (normalized.regions?.length) count += 1;
  if (normalized.name) count += 1;
  if (normalized.geo) count += 1;
  if (normalized.games) count += 1;
  if (normalized.machines) count += 1;
  // One per engaged hours row / flag; normalizeShopFilterState has already
  // removed the ones that match nothing.
  if (normalized.hours) count += Object.keys(normalized.hours).length;
  if (normalized.status?.closed) count += 1;
  if (normalized.activity) count += 1;
  if (normalized.advanced) count += 1;
  return count;
};

type Range = { min?: number; max?: number };

/** Coerce one bound to the non-negative integer the schema demands. */
const sanitizeBound = (value: number): number => Math.max(0, Math.floor(value));

/** Drop bounds that are not finite numbers, and order the rest so `min <= max`. */
const sanitizeRange = (range: Range): Range | undefined => {
  const cleaned: Range = {};
  if (typeof range.min === 'number' && Number.isFinite(range.min)) {
    cleaned.min = sanitizeBound(range.min);
  }
  if (typeof range.max === 'number' && Number.isFinite(range.max)) {
    cleaned.max = sanitizeBound(range.max);
  }
  if (cleaned.min !== undefined && cleaned.max !== undefined && cleaned.min > cleaned.max) {
    [cleaned.min, cleaned.max] = [cleaned.max, cleaned.min];
  }
  return cleaned.min === undefined && cleaned.max === undefined ? undefined : cleaned;
};

const sanitizeRanges = <T extends { [K in keyof T]: Range | undefined }>(section: T): T => {
  for (const key of Object.keys(section) as Array<keyof T>) {
    const range = section[key];
    if (!range) continue;
    const cleaned = sanitizeRange(range);
    if (cleaned) section[key] = cleaned as T[keyof T];
    else delete section[key];
  }
  return section;
};

/**
 * Make panel output round-trippable. The editor deliberately keeps
 * partially-filled rows while the user works, and a single field the strict
 * schema rejects would make `parseShopFilterParam` discard the ENTIRE filter —
 * silently losing every unrelated section. So: clamp the numeric ranges here,
 * then let `normalizeShopFilterState` drop the game leaves, schedule rows and
 * other partial shapes no query builder would act on. Runs right before
 * serialization.
 */
export const sanitizeShopFilterState = (state: ShopFilterState): ShopFilterState => {
  // Start from the whole draft; normalizeShopFilterState below prunes whatever
  // no query builder would act on, so only the ranges need fixing up here.
  const cleaned: ShopFilterState = { ...state };
  if (state.name) {
    // The strict schema demands a non-empty value (≤64 chars) and a known
    // mode; trim, clamp and coerce here so a malformed name never discards
    // the unrelated sections around it.
    const value = (state.name.value ?? '').trim().slice(0, 64);
    if (value) {
      cleaned.name = {
        value,
        mode: state.name.mode === 'exact' ? 'exact' : 'contains'
      };
    } else {
      delete cleaned.name;
    }
  }
  if (state.machines) {
    const machines = sanitizeRanges({ ...state.machines });
    if (Object.keys(machines).length > 0) cleaned.machines = machines;
    else delete cleaned.machines;
  }
  if (state.activity) {
    const activity = { ...state.activity };
    const attendance = sanitizeRange(activity.attendance ?? {});
    if (attendance) activity.attendance = attendance;
    else delete activity.attendance;
    if (activity.gameAttendance?.length) {
      const rows: NonNullable<typeof activity.gameAttendance> = [];
      for (const row of activity.gameAttendance) {
        if (row.titleIds.length === 0) continue;
        const range = sanitizeRange(row);
        if (!range) continue;
        rows.push({
          titleIds: [...row.titleIds],
          ...(range.min === undefined ? {} : { min: range.min }),
          ...(range.max === undefined ? {} : { max: range.max })
        });
      }
      if (rows.length > 0) activity.gameAttendance = rows;
      else delete activity.gameAttendance;
    }
    if (Object.keys(activity).length > 0) cleaned.activity = activity;
  }
  // Clamping ranges above is about the strict schema; normalization below is
  // about agreeing with the query builders (see normalizeShopFilterState).
  return normalizeShopFilterState(cleaned);
};

export { SHOP_FILTER_VERSION };

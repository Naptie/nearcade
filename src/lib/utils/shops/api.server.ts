/**
 * Single projection from a persisted shop document to the public API shape.
 *
 * Every endpoint that returns a shop goes through {@link toShopApi} instead of
 * spreading the document (`{ ...shop }`). The persisted document also carries
 * `_id` and the derived query caches (`openingMinutes`, `aggGames`,
 * `gameTokens`, `stats`); spreading them is exactly how those leaked into
 * responses and into the OpenAPI schema in the first place. Listing the public
 * fields explicitly means a new cache field can never reach a client by
 * accident — it has to be added here, deliberately.
 *
 * WHY THIS IS ITS OWN MODULE — the shape of the wire contract is a decision
 * about what a client may see, and it has to be reviewable without reading the
 * address resolution, the derived-field computation or any query builder. The
 * projection is also the single place that knows which derived values are
 * read-time (`timezone.offset`, `isOpen`) rather than persisted, which is the
 * rule that was previously duplicated per endpoint.
 *
 * It stays separate from `derived.ts` (which is client-safe and must not gain
 * server imports) and from `endpoints/shop-search.server.ts` (an orchestrator
 * over Mongo + Meilisearch). Both of those are the wrong direction to depend on.
 */
import type { Shop, ShopApi } from '$lib/types';
import { getShopTimeInfo } from '$lib/utils';
import { getLocale } from '$lib/paraglide/runtime';
import { toShopApiAddress } from '$lib/utils/region.server';

export interface ShopApiProjectionOptions {
  /** Attach the per-request `timezone` / `isOpen` computation. */
  includeTimeInfo?: boolean;
  /** Locale used to resolve region names and the derived `address.general`. */
  locale?: string;
  /** Reference instant for `isOpen`; shared across a batch for consistency. */
  now?: Date;
}

/**
 * Project a persisted shop document onto the public API shape.
 *
 * The region chain is stored as IDs only; localized names (and the matching
 * `address.general`) are resolved here, once per response.
 */
export const toShopApi = async (
  shop: Shop,
  { includeTimeInfo = true, locale = getLocale(), now = new Date() }: ShopApiProjectionOptions = {}
): Promise<ShopApi> => ({
  id: shop.id,
  name: shop.name,
  comment: shop.comment,
  address: await toShopApiAddress(
    shop.address ?? { general: [], detailed: '', region: [] },
    locale
  ),
  openingHours: shop.openingHours,
  games: shop.games,
  location: shop.location,
  ...(includeTimeInfo ? getShopTimeInfo(shop, now) : {}),
  ...(shop.isClaimed === undefined ? {} : { isClaimed: shop.isClaimed }),
  ...(shop.ownerId === undefined ? {} : { ownerId: shop.ownerId }),
  ...(shop.isLocked === undefined ? {} : { isLocked: shop.isLocked }),
  ...(shop.isClosed === undefined ? {} : { isClosed: shop.isClosed }),
  ...(shop.closedReason === undefined ? {} : { closedReason: shop.closedReason }),
  ...(shop.transit === undefined ? {} : { transit: shop.transit }),
  createdAt: shop.createdAt,
  updatedAt: shop.updatedAt
});

/** Batch variant of {@link toShopApi}. */
export const toShopApiList = (
  shops: Shop[],
  options?: ShopApiProjectionOptions
): Promise<ShopApi[]> => Promise.all(shops.map((shop) => toShopApi(shop, options)));

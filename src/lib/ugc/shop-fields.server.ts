import type { Shop } from '$lib/types';

/**
 * Auditable field key → raw text for one shop document. The single mapping
 * shared by the shop write path and the changelog rollback, so both register
 * the exact same field set (key grammar: `resolveUgcOccurrence`).
 */
export const shopUgcTexts = (shop: Shop): Record<string, string> => ({
  shop_name: shop.name,
  shop_description: shop.comment ?? '',
  shop_address: shop.address?.detailed ?? '',
  ...Object.fromEntries(
    (shop.games ?? []).flatMap((game) => [
      [`game_name:${game.gameId}`, game.name],
      [`game_version:${game.gameId}`, game.version ?? ''],
      [`game_cost:${game.gameId}`, game.cost ?? ''],
      [`game_description:${game.gameId}`, game.comment ?? '']
    ])
  )
});

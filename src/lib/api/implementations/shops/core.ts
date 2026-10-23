/**
 * Core shop CRUD: the paginated list, creation, detail, update, and the
 * admin-only patch.
 *
 * The game-normalisation helpers that decide how an incoming game list maps
 * onto the stored `gameId` values live in `$lib/utils/shops/games.server`,
 * because they are about games rather than about the route that uses them.
 */

import { shopsCoreListImplementation } from './core-list';
import { shopsCoreCreateImplementation } from './core-create';
import { shopsCoreDetailImplementation } from './core-detail';
import { shopsCoreUpdateImplementation } from './core-update';

/**
 * The core shop implementation, assembled from the four groups above.
 *
 * Every group binds `implement()` against the full `shopsContract`, so the
 * union of the groups is checked against the contract once, here, when
 * `src/lib/api/router.ts` passes this object to `implement(contractRouter)`.
 * A procedure moved but not re-exported, or re-exported but never written,
 * is a compile error rather than a runtime 404.
 */
export const shopsCoreImplementation = {
  ...shopsCoreListImplementation,
  ...shopsCoreCreateImplementation,
  ...shopsCoreDetailImplementation,
  ...shopsCoreUpdateImplementation
};

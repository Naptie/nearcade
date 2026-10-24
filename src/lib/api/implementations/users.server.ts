import { usersActivityImplementation } from './users/activity.server';
import { usersAvatarImplementation } from './users/avatar.server';
import { usersLookupImplementation } from './users/lookup.server';
import { usersProfileImplementation } from './users/profile.server';

/**
 * The user implementation, assembled from the groups above.
 *
 * Every group binds `implement()` against the full `usersContract`, so the
 * union of the groups is checked against the contract once, here, when
 * `src/lib/api/router.ts` passes this object to `implement(contractRouter)`.
 * A procedure moved but not re-exported, or re-exported but never written,
 * is a compile error rather than a runtime 404.
 */
export const usersImplementation = {
  ...usersLookupImplementation,
  ...usersProfileImplementation,
  ...usersActivityImplementation,
  ...usersAvatarImplementation
};

import { clubsListImplementation } from './clubs/list';
import { clubsDetailImplementation } from './clubs/detail';
import { clubsArcadesImplementation } from './clubs/arcades';
import { clubsAvatarImplementation } from './clubs/avatar';
import { clubsMembersImplementation } from './clubs/members';
import { clubsPostsImplementation } from './clubs/posts';

/**
 * The club implementation, assembled from the six groups above.
 *
 * Every group binds `implement()` against the full `clubsContract`, so the
 * union of the groups is checked against the contract once, here, when
 * `src/lib/api/router.ts` passes this object to `implement(contractRouter)`.
 * A procedure moved but not re-exported, or re-exported but never written,
 * is a compile error rather than a runtime 404.
 */
export const clubsImplementation = {
  ...clubsListImplementation,
  ...clubsDetailImplementation,
  ...clubsArcadesImplementation,
  ...clubsAvatarImplementation,
  ...clubsMembersImplementation,
  ...clubsPostsImplementation
};

import { universitiesSearchImplementation } from './universities/search';
import { universitiesDetailImplementation } from './universities/detail';
import { universitiesAvatarImplementation } from './universities/avatar';
import { universitiesChangelogImplementation } from './universities/changelog';
import { universitiesClubsImplementation } from './universities/clubs';
import { universitiesMembersImplementation } from './universities/members';
import { universitiesPostsImplementation } from './universities/posts';

/**
 * The university implementation, assembled from the seven groups above.
 *
 * Every group binds `implement()` against the full `universitiesContract`, so
 * the union of the groups is checked against the contract once, here, when
 * `src/lib/api/router.ts` passes this object to `implement(contractRouter)`.
 * A procedure moved but not re-exported, or re-exported but never written,
 * is a compile error rather than a runtime 404.
 */
export const universitiesImplementation = {
  ...universitiesSearchImplementation,
  ...universitiesDetailImplementation,
  ...universitiesAvatarImplementation,
  ...universitiesChangelogImplementation,
  ...universitiesClubsImplementation,
  ...universitiesMembersImplementation,
  ...universitiesPostsImplementation
};

import { universitiesSearchImplementation } from './universities/search.server';
import { universitiesDetailImplementation } from './universities/detail.server';
import { universitiesAvatarImplementation } from './universities/avatar.server';
import { universitiesChangelogImplementation } from './universities/changelog.server';
import { universitiesClubsImplementation } from './universities/clubs.server';
import { universitiesMembersImplementation } from './universities/members.server';
import { universitiesPostsImplementation } from './universities/posts.server';

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

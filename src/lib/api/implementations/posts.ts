import { postsCommentsImplementation } from './posts/comments';
import { postsDetailImplementation } from './posts/detail';
import { postsMutateImplementation } from './posts/mutate';
import { postsVoteImplementation } from './posts/vote';

/**
 * The post implementation, assembled from the four groups above.
 *
 * Every group binds `implement()` against the full `postsContract`, so the
 * union of the groups is checked against the contract once, here, when
 * `src/lib/api/router.ts` passes this object to `implement(contractRouter)`.
 * A procedure moved but not re-exported, or re-exported but never written,
 * is a compile error rather than a runtime 404.
 */
export const postsImplementation = {
  ...postsDetailImplementation,
  ...postsMutateImplementation,
  ...postsCommentsImplementation,
  ...postsVoteImplementation
};

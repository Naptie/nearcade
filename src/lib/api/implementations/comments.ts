import { commentsMutateImplementation } from './comments/mutate';
import { commentsVoteImplementation } from './comments/vote';

/**
 * The comment implementation, assembled from the two groups above.
 *
 * Every group binds `implement()` against the full `commentsContract`, so the
 * union of the groups is checked against the contract once, here, when
 * `src/lib/api/router.ts` passes this object to `implement(contractRouter)`.
 * A procedure moved but not re-exported, or re-exported but never written,
 * is a compile error rather than a runtime 404.
 */
export const commentsImplementation = {
  ...commentsMutateImplementation,
  ...commentsVoteImplementation
};

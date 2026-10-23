import { shopsCoreImplementation } from './core';
import { shopsAttendanceImplementation } from './attendance';
import { shopsChangelogImplementation } from './changelog';
import { shopsCommentsImplementation } from './comments';
import { shopsPhotosImplementation } from './photos';
import { shopsQueuesImplementation } from './queues';
import { shopsDeleteRequestsImplementation } from './delete-requests';

/**
 * The shop implementation, assembled from the seven groups above.
 *
 * Every group binds `implement()` against the full `shopsContract`, so the
 * union of the groups is checked against the contract once, here, when
 * `src/lib/api/router.ts` passes this object to `implement(contractRouter)`.
 * A procedure moved but not re-exported, or re-exported but never written,
 * is a compile error rather than a runtime 404.
 */
export const shopsImplementation = {
  ...shopsCoreImplementation,
  ...shopsAttendanceImplementation,
  ...shopsChangelogImplementation,
  ...shopsCommentsImplementation,
  ...shopsPhotosImplementation,
  ...shopsQueuesImplementation,
  ...shopsDeleteRequestsImplementation
};

import { shopsCoreImplementation } from './core.server';
import { shopsAttendanceImplementation } from './attendance.server';
import { shopsChangelogImplementation } from './changelog.server';
import { shopsCommentsImplementation } from './comments.server';
import { shopsPhotosImplementation } from './photos.server';
import { shopsQueuesImplementation } from './queues.server';
import { shopsDeleteRequestsImplementation } from './delete-requests.server';

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

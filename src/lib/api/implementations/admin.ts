import { adminDataUpdatesImplementation } from './admin/data-updates';
import { adminOrganizationsImplementation } from './admin/organizations';
import { adminRegionsImplementation } from './admin/regions';
import { adminShopsImplementation } from './admin/shops';
import { adminUgcImplementation } from './admin/ugc';
import { adminUsersImplementation } from './admin/users';

/**
 * The admin implementation, assembled from the groups above.
 *
 * Every group binds `implement()` against the full `adminContract`, so the
 * union of the groups is checked against the contract once, here, when
 * `src/lib/api/router.ts` passes this object to `implement(contractRouter)`.
 * A procedure moved but not re-exported, or re-exported but never written,
 * is a compile error rather than a runtime 404.
 */
export const adminImplementation = {
  ...adminDataUpdatesImplementation,
  ...adminOrganizationsImplementation,
  ...adminRegionsImplementation,
  ...adminShopsImplementation,
  ...adminUgcImplementation,
  ...adminUsersImplementation
};

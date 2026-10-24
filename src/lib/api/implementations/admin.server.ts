import { adminDataUpdatesImplementation } from './admin/data-updates.server';
import { adminOrganizationsImplementation } from './admin/organizations.server';
import { adminRegionsImplementation } from './admin/regions.server';
import { adminShopsImplementation } from './admin/shops.server';
import { adminUgcImplementation } from './admin/ugc.server';
import { adminUsersImplementation } from './admin/users.server';

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

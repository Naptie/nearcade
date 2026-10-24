/**
 * Shop attendance: read the counts, report or register attendance, leave,
 * and the kiosk registration tokens.
 *
 * The three groups below cover the whole surface: the read, the writes that
 * the presence of a player and the live occupancy go through, and the kiosk
 * registration tokens.
 */

import { shopsAttendanceReadImplementation } from './attendance-read';
import { shopsAttendanceWriteImplementation } from './attendance-write';
import { shopsAttendanceRegistrationImplementation } from './attendance-registration';

/**
 * The shop attendance implementation, assembled from the three groups above.
 *
 * Every group binds `implement()` against the full `shopsContract`, so the
 * union of the groups is checked against the contract once, here, when
 * `src/lib/api/router.ts` passes this object to `implement(contractRouter)`.
 * A procedure moved but not re-exported, or re-exported but never written,
 * is a compile error rather than a runtime 404.
 */
export const shopsAttendanceImplementation = {
  ...shopsAttendanceReadImplementation,
  ...shopsAttendanceWriteImplementation,
  ...shopsAttendanceRegistrationImplementation
};

/**
 * The attendance writes: registering your own presence, reporting the live
 * occupancy and leaving.
 *
 * The capabilities themselves live in the modules next door — the live
 * presence in `./attendance-presence`, the live occupancy in
 * `./attendance-report` — so that the deprecated endpoint and the endpoint
 * that replaced it cannot drift apart.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import { refreshShopAttendanceStats } from '$lib/endpoints/attendance-stats.server';
import { m } from '$lib/paraglide/messages';
import type { Shop } from '$lib/types';
import { requireBoundPhone } from '$lib/utils/index.server';
import { apiError, rethrowApiError } from '../../errors';
import { shopsContract } from '../../contracts/shops';
import type { ApiContext } from '../../context';
import { resolveAttendanceCaller, resolveAttendanceTarget } from './attendance-caller';
import { leave, registerAttendance } from './attendance-presence';
import { writeAttendanceCounts } from './attendance-report';

const impl = implement(shopsContract).$context<ApiContext>();

export const shopsAttendanceWriteImplementation = {
  /**
   * `POST /api/shops/{id}/attendance` — deprecated.
   *
   * Forwards to the endpoint that performs the capability the payload asks
   * for. Each of those demands the scope of its own capability, so the
   * forwarding is transparent to the scope matrix: a third-party OAuth client
   * still needs `write:attendance` to register its presence and
   * `write:reports` to report the live counts.
   */
  reportAttendance: impl.reportAttendance.handler(async ({ input, context }) => {
    const { games, plannedLeaveAt } = input;

    // Validate input
    if (
      !games ||
      !Array.isArray(games) ||
      (games.every((g) => g.currentAttendances === undefined) && !plannedLeaveAt)
    ) {
      apiError('BAD_REQUEST', m.missing_required_parameters());
    }

    try {
      const caller = await resolveAttendanceCaller(input, context);
      const { shop, shopGames, now, openTolerated, closeTolerated } = await resolveAttendanceTarget(
        input,
        games.map((g) => g.id),
        caller
      );

      if (!caller.isOpenApiAccess && plannedLeaveAt) {
        await registerAttendance(
          caller,
          shop,
          shopGames,
          plannedLeaveAt,
          openTolerated,
          closeTolerated
        );
      } else if (games.some((g) => g.currentAttendances !== undefined)) {
        await writeAttendanceCounts(input, caller, shop, now, closeTolerated);
      }

      await refreshShopAttendanceStats(shop);

      return { success: true };
    } catch (err) {
      rethrowApiError(err, m.failed_to_create_attendance());
    }
  }),

  /** `POST /api/shops/{id}/attendance/new` */
  registerAttendance: impl.registerAttendance.handler(async ({ input, context }) => {
    const { games, plannedLeaveAt } = input;

    if (!games || !Array.isArray(games) || !plannedLeaveAt) {
      apiError('BAD_REQUEST', m.missing_required_parameters());
    }

    try {
      const caller = await resolveAttendanceCaller(input, context);
      const { shop, shopGames, openTolerated, closeTolerated } = await resolveAttendanceTarget(
        input,
        games.map((g) => g.id),
        caller
      );

      await registerAttendance(
        caller,
        shop,
        shopGames,
        plannedLeaveAt,
        openTolerated,
        closeTolerated
      );

      await refreshShopAttendanceStats(shop);

      return { success: true };
    } catch (err) {
      rethrowApiError(err, m.failed_to_create_attendance());
    }
  }),

  /** `POST /api/shops/{id}/attendance/reports` */
  reportAttendanceCounts: impl.reportAttendanceCounts.handler(async ({ input, context }) => {
    const { games } = input;

    if (!games || !Array.isArray(games) || games.every((g) => g.currentAttendances === undefined)) {
      apiError('BAD_REQUEST', m.missing_required_parameters());
    }

    try {
      const caller = await resolveAttendanceCaller(input, context);
      const { shop, now, closeTolerated } = await resolveAttendanceTarget(
        input,
        games.map((g) => g.id),
        caller
      );

      await writeAttendanceCounts(input, caller, shop, now, closeTolerated);

      await refreshShopAttendanceStats(shop);

      return { success: true };
    } catch (err) {
      rethrowApiError(err, m.failed_to_create_attendance());
    }
  }),

  /** `DELETE /api/shops/{id}/attendance` */
  leaveAttendance: impl.leaveAttendance.handler(async ({ input, context }) => {
    // `guard: 'session'` on the contract already rejected an unauthenticated
    // request, so the session is present by construction.
    const session = context.session!;

    requireBoundPhone(session.user);

    try {
      const id = input.id;

      const db = mongo.db();
      const shopsCollection = db.collection<Shop>('shops');
      const shop = await shopsCollection.findOne({
        id
      });
      if (!shop) {
        apiError('NOT_FOUND', m.shop_not_found());
      }

      await leave(session.user, shop);
      await refreshShopAttendanceStats(shop);

      return { success: true };
    } catch (err) {
      rethrowApiError(err, m.failed_to_remove_attendance());
    }
  })
};

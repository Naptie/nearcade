/**
 * The attendance read: the counts a shop is showing right now.
 *
 * The counts come from two places at once — the users who registered their
 * presence and the agents who reported the live occupancy — so the endpoint
 * asks the shared attendance loader for both and merges them.
 */

import { implement } from '@orpc/server';
import { getShopsAttendanceData } from '$lib/endpoints/attendance.server';
import { m } from '$lib/paraglide/messages';
import { attendanceResponseSchema } from '$lib/schemas/shops';
import { rethrowApiError } from '../../errors';
import { shopsContract } from '../../contracts/shops';
import type { ApiContext } from '../../context';
import { toPlainWire } from './shared.server';

const impl = implement(shopsContract).$context<ApiContext>();

export const shopsAttendanceReadImplementation = {
  /** `GET /api/shops/{id}/attendance` */
  attendance: impl.attendance.handler(async ({ input, context }) => {
    try {
      const reported = input.reported;
      const fetchRegistered = ['0', 'false'].includes(reported || 'false');
      const fetchReported = ['1', 'true'].includes(reported || 'true');

      const id = input.id;

      const session = context.session;

      const attendanceData = await getShopsAttendanceData([id], {
        fetchRegistered,
        fetchReported,
        session
      });

      const result = attendanceData.get(id.toString())!;

      return toPlainWire(attendanceResponseSchema, {
        success: true,
        total: result.total,
        games: result.games.map((game) => ({
          ...game,
          comment: '',
          cost: ''
        })),
        registered: result.registered.map((entry) => ({
          ...entry,
          user: entry.user
        })),
        reported: result.reported.map((entry) => ({
          ...entry,
          currentAttendances: entry.currentAttendances ?? 0,
          reporter: entry.reporter
        }))
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_get_attendance());
    }
  })
};

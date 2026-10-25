/**
 * The live occupancy report of a shop.
 *
 * The figures land in Redis, where they expire with the shop's opening hours,
 * and in the `attendance_reports` collection. The note travels through UGC
 * moderation. An agent key bound to the shop may also register or clear
 * another user's presence through the per-game `attend` flag.
 */

import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { m } from '$lib/paraglide/messages';
import type { Shop } from '$lib/types';
import type { AttendanceReportRecord } from '$lib/types/index.server';
import { auditUgc, blockedUgcMessage } from '$lib/ugc/audit.server';
import { submitUgc } from '$lib/ugc/entries.server';
import { apiError } from '../../errors';
import { requireScope, type AttendanceCaller } from './attendance-caller.server';
import { attend, leave } from './attendance-presence.server';

export const writeAttendanceCounts = async (
  input: {
    games: { id: number; currentAttendances?: number; attend?: boolean }[];
    comment?: string;
  },
  caller: AttendanceCaller,
  shop: Shop,
  now: number,
  closeTolerated: Date
) => {
  const { games, comment } = input;

  // Reporting the live occupancy is the `write:reports` capability. The check
  // lives here rather than on the route so that every caller of this helper
  // gets it — including the deprecated endpoint that forwards to it.
  requireScope(caller, 'write:reports');

  // Tier-0 moderation gate on the attendance note.
  const blocked = await auditUgc('attendance_report', shop.id, comment ?? '');
  if (blocked) {
    apiError('BAD_REQUEST', blockedUgcMessage(blocked));
  }

  for (const game of games) {
    if (
      game.currentAttendances === undefined ||
      typeof game.currentAttendances !== 'number' ||
      isNaN(game.currentAttendances) ||
      game.currentAttendances < 0
    ) {
      apiError('BAD_REQUEST', m.invalid_current_attendances_for_game({ id: game.id }));
    }
    const attendanceKey = `nearcade:attend-report:${shop.id}:${game.id}`;
    const attendanceData = {
      currentAttendances: game.currentAttendances,
      reportedBy: caller.user.id,
      reportedAt: new Date().toISOString(),
      comment: comment || null
    };
    const ttlSeconds = Math.max(Math.floor((closeTolerated.getTime() - now) / 1000), 60); // Minimum 60 seconds

    // Store attendance in Redis
    await ensureConnected();
    await redis.setEx(attendanceKey, ttlSeconds, JSON.stringify(attendanceData));

    if (
      caller.isAttendingOnBehalf &&
      caller.attendingUser &&
      'attend' in game &&
      typeof game.attend === 'boolean'
    ) {
      if (game.attend) {
        await attend(caller.attendingUser, shop, {
          games: [{ id: game.id }],
          attendedAt: new Date(),
          plannedLeaveAt: closeTolerated
        });
      } else {
        await leave(caller.attendingUser, shop);
      }
    }
  }

  const db = mongo.db();
  const attendanceReportsCollection = db.collection<AttendanceReportRecord>('attendance_reports');
  const inserted = await attendanceReportsCollection.insertOne({
    shopId: shop.id,
    games: games.map((game) => {
      const shopGame = shop.games.find((g) => g.gameId === game.id);
      return {
        gameId: game.id,
        name: shopGame ? shopGame.name : 'Unknown Game',
        version: shopGame ? shopGame.version : '',
        currentAttendances: game.currentAttendances || 0
      };
    }),
    comment: comment || null,
    reportedBy: caller.user.id!,
    reportedAt: new Date()
  });

  // Register the note as a content occurrence (the report is its own
  // content unit, so refId is the report id).
  submitUgc('attendance_report', String(inserted.insertedId), caller.user, {
    comment: comment || ''
  });
};

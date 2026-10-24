/**
 * The live presence of a player at a shop.
 *
 * The live session lives in Redis under `attend` / `leave`; leaving appends
 * the finished session to the MongoDB `attendances` collection. Registering
 * your own presence is what writes that session.
 */

import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import type { User } from '$lib/auth/types';
import { m } from '$lib/paraglide/messages';
import type { Shop } from '$lib/types';
import type { AttendanceRecord } from '$lib/types/index.server';
import { getCurrentAttendance } from '$lib/utils/index.server';
import { apiError } from '../../errors';
import { requireScope, type AttendanceCaller } from './attendance-caller';

export const attend = async (
  user: User,
  shop: Shop,
  data: {
    games: {
      id: number;
    }[];
    attendedAt: Date;
    plannedLeaveAt: Date;
  }
) => {
  const { id } = shop;
  const { games, attendedAt, plannedLeaveAt } = data;
  const attendanceKey = `nearcade:attend:${id}:${user.id}:${encodeURIComponent(attendedAt.toISOString())}:${games.map((g) => g.id).join(',')}`;
  const attendanceData = {
    games,
    attendedAt: attendedAt.toISOString(),
    plannedLeaveAt: plannedLeaveAt.toISOString()
  };

  // Calculate TTL in seconds
  const plannedLeave = plannedLeaveAt.getTime();
  const ttlSeconds = Math.max(Math.floor((plannedLeave - Date.now()) / 1000), 60); // Minimum 60 seconds

  // Store attendance in Redis with expiration
  await ensureConnected();
  await redis.setEx(attendanceKey, ttlSeconds, JSON.stringify(attendanceData));
};

export const leave = async (user: User, shop: Shop) => {
  const { id } = shop;
  const pattern = `nearcade:attend:${id}:${user.id}:*`;
  await ensureConnected();
  const keys = await redis.keys(pattern);
  if (keys.length === 0) {
    apiError('NOT_FOUND', m.attendance_not_found());
  }

  // Only one active attendance per user per shop
  const attendanceKey = keys[0];

  // Get the attendance data before deleting
  const attendanceDataStr = await redis.get(attendanceKey);
  if (!attendanceDataStr) {
    apiError('NOT_FOUND', m.attendance_not_found());
  }

  const attendanceData = JSON.parse(attendanceDataStr);

  // Delete from Redis
  await redis.del(attendanceKey);

  // Add to MongoDB attendances collection
  const db = mongo.db();
  const attendancesCollection = db.collection<AttendanceRecord>('attendances');

  await attendancesCollection.insertOne({
    userId: user.id!,
    games: attendanceData.games.map((game: { id: number }) => {
      const shopGame = shop?.games.find((g) => g.gameId === game.id);
      return {
        gameId: game.id,
        name: shopGame ? shopGame.name : 'Unknown Game',
        version: shopGame ? shopGame.version : ''
      };
    }),
    shopId: id,
    attendedAt: new Date(attendanceData.attendedAt),
    leftAt: new Date() // Actual leave time
  });
};

/**
 * Register the caller's own presence at a shop.
 *
 * The user shows up in the player list of the machine they are playing, and
 * their attendance count feeds the "frequently visited" list once it crosses
 * the user's own threshold — the server derives that, the user never sets it.
 */
export const registerAttendance = async (
  caller: AttendanceCaller,
  shop: Shop,
  shopGames: { gameId: number }[],
  plannedLeaveAt: string | Date,
  openTolerated: Date,
  closeTolerated: Date
) => {
  const { user } = caller;

  // Registering your own presence is the `write:attendance` capability. The
  // check lives here rather than on the route so that every caller of this
  // helper gets it — including the deprecated endpoint that forwards to it.
  requireScope(caller, 'write:attendance');

  // Registering is a session capability. An agent API key may report attendance
  // counts — and register somebody else's presence while it does — but it never
  // registers its own. The legacy route enforced this by only offering the
  // register branch to a caller without an agent key; the rule lives here so it
  // cannot be lost by a route that admits one.
  if (caller.isOpenApiAccess) {
    apiError('FORBIDDEN', m.access_denied());
  }

  // Check for existing attendance
  if (await getCurrentAttendance(user.id!)) {
    apiError('CONFLICT', m.user_already_has_an_active_attendance());
  }

  const plannedLeaveTime = new Date(plannedLeaveAt);

  if (
    plannedLeaveTime < new Date(Date.now() + 8 * 60 * 1000) ||
    plannedLeaveTime < openTolerated ||
    plannedLeaveTime > closeTolerated
  ) {
    apiError('BAD_REQUEST', m.invalid_planned_leave_time());
  }

  await attend(user, shop, {
    games: shopGames.map((g) => ({
      id: g.gameId
    })),
    attendedAt: new Date(),
    plannedLeaveAt: plannedLeaveTime
  });

  if (!user.frequentingArcades?.some((a) => a === shop.id)) {
    const db = mongo.db();
    const attendancesCollection = db.collection<AttendanceRecord>('attendances');
    const count = await attendancesCollection.countDocuments({
      userId: user.id!,
      shopId: shop.id
    });
    if (count + 1 >= (user.autoDiscovery?.attendanceThreshold ?? 2)) {
      const usersCollection = db.collection<User>('users');
      await usersCollection.updateOne(
        { id: user.id! },
        {
          $addToSet: {
            frequentingArcades: shop.id
          },
          $set: { updatedAt: new Date() }
        }
      );
    }
  }
};

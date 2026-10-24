/**
 * The kiosk registration tokens.
 *
 * A machine asks for a short-lived token, the player confirms it at the
 * attend page, and the kiosk reads the token back to learn which user took
 * the slot. The token itself never leaves Redis.
 */

import { implement } from '@orpc/server';
import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { m } from '$lib/paraglide/messages';
import { attendanceRegistrationGetResponseSchema } from '$lib/schemas/machines';
import type { User } from '$lib/auth/types';
import type { Shop } from '$lib/types';
import { protect } from '$lib/utils';
import { isUserQueued, registrationKey, validateMachineAuth } from '$lib/utils/machine.server';
import { apiError, rethrowApiError } from '../../errors';
import { shopsContract } from '../../contracts/shops';
import type { ApiContext } from '../../context';
import { toPlainWire } from './shared';

const impl = implement(shopsContract).$context<ApiContext>();

export const shopsAttendanceRegistrationImplementation = {
  /** `POST /api/shops/{id}/attendance/registration` */
  createAttendanceRegistration: impl.createAttendanceRegistration.handler(
    async ({ input, context }) => {
      const MAX_EXPIRATION_SECONDS = 2 * 60; // 2 minutes

      try {
        const id = input.id;

        // Validate machine authentication
        const machine = await validateMachineAuth(context.event.request, id);

        const { slotIndex, expires } = input;

        // Calculate expiration (max 2 minutes)
        const ttlSeconds = Math.min(
          Math.max(expires || MAX_EXPIRATION_SECONDS, 10),
          MAX_EXPIRATION_SECONDS
        );

        // Generate a unique token
        const token = nanoid(24);

        // Store registration data in Redis
        const registration = {
          shopId: id.toString(),
          machineId: machine.id,
          slotIndex,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
        };

        await ensureConnected();
        await redis.setEx(registrationKey(token), ttlSeconds, JSON.stringify(registration));

        // Get shop name for display
        const db = mongo.db();
        const shop = await db.collection<Shop>('shops').findOne({ id });

        return {
          success: true,
          token,
          expiresAt: registration.expiresAt,
          shopName: shop?.name || null
        };
      } catch (err) {
        rethrowApiError(err, m.failed_to_create_registration());
      }
    }
  ),

  /** `GET /api/shops/{id}/attendance/registration` */
  getAttendanceRegistration: impl.getAttendanceRegistration.handler(async ({ input, context }) => {
    try {
      const id = input.id;
      const { token } = input;

      // Validate machine authentication
      await validateMachineAuth(context.event.request, id);

      // Get registration from Redis
      await ensureConnected();
      const registrationStr = await redis.get(registrationKey(token));

      if (!registrationStr) {
        apiError('NOT_FOUND', m.registration_not_found_or_expired());
      }

      const registration = JSON.parse(registrationStr);

      // Verify the registration belongs to this shop
      if (registration.shopId !== id.toString()) {
        apiError('FORBIDDEN', m.access_denied());
      }

      let user: User | undefined = undefined;
      let alreadyInQueue = false;
      if (registration.userId) {
        const db = mongo.db();
        const usersCollection = db.collection<User>('users');
        user = (await usersCollection.findOne({ id: registration.userId })) ?? undefined;
        // Surface duplicate registrations to the kiosk even if the attend page was
        // validated earlier (covers races and accounts queued at other shops).
        alreadyInQueue = await isUserQueued(registration.userId);
      }

      return toPlainWire(attendanceRegistrationGetResponseSchema, {
        success: true,
        registration: user
          ? { ...registration, alreadyInQueue, user: protect(user) }
          : { ...registration, alreadyInQueue }
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_get_registration());
    }
  }),

  /** `DELETE /api/shops/{id}/attendance/registration` */
  deleteAttendanceRegistration: impl.deleteAttendanceRegistration.handler(
    async ({ input, context }) => {
      try {
        const id = input.params.id;
        const { token } = input.query;

        // Validate machine authentication
        await validateMachineAuth(context.event.request, id);

        // Delete registration from Redis
        await ensureConnected();
        const deleted = await redis.del(registrationKey(token));

        if (deleted === 0) {
          apiError('NOT_FOUND', m.registration_not_found_or_expired());
        }

        return { success: true };
      } catch (err) {
        rethrowApiError(err, m.failed_to_delete_registration());
      }
    }
  )
};

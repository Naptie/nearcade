import { error, json, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import type { AttendanceRegistration, Shop } from '$lib/types';
import { m } from '$lib/paraglide/messages';
import { nanoid } from 'nanoid';
import type { User } from '$lib/auth/types';
import { protect, toPlainObject } from '$lib/utils';
import { validateMachineAuth } from '$lib/utils/machine.server';
import { isUserQueued } from '$lib/utils/machine.server';
import {
  attendanceRegistrationPostRequestSchema,
  attendanceRegistrationCreateResponseSchema,
  attendanceRegistrationGetResponseSchema,
  registrationQuerySchema
} from '$lib/schemas/machines';
import { shopIdParamSchema } from '$lib/schemas/shops';
import {
  parseJsonOrError,
  parseParamsOrError,
  parseQueryOrError
} from '$lib/utils/validation.server';
import { successResponseSchema } from '$lib/schemas/common';

const REGISTRATION_KEY_PREFIX = 'nearcade:registration:';
const MAX_EXPIRATION_SECONDS = 2 * 60; // 2 minutes

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const { id } = parseParamsOrError(shopIdParamSchema, params);

    // Validate machine authentication
    const machine = await validateMachineAuth(request, id);

    const body = await parseJsonOrError(request, attendanceRegistrationPostRequestSchema);

    const { slotIndex, expires } = body;

    // Calculate expiration (max 2 minutes)
    const ttlSeconds = Math.min(
      Math.max(expires || MAX_EXPIRATION_SECONDS, 10),
      MAX_EXPIRATION_SECONDS
    );

    // Generate a unique token
    const token = nanoid(24);

    // Store registration data in Redis
    const registration: AttendanceRegistration = {
      shopId: id.toString(),
      machineId: machine.id,
      slotIndex,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
    };

    await ensureConnected();
    await redis.setEx(
      `${REGISTRATION_KEY_PREFIX}${token}`,
      ttlSeconds,
      JSON.stringify(registration)
    );

    // Get shop name for display
    const db = mongo.db();
    const shop = await db.collection<Shop>('shops').findOne({ id });

    const response = attendanceRegistrationCreateResponseSchema.parse({
      success: true,
      token,
      expiresAt: registration.expiresAt,
      shopName: shop?.name || null
    });

    return json(response);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error creating registration token:', err);
    error(500, m.failed_to_create_registration());
  }
};

export const GET: RequestHandler = async ({ params, request, url }) => {
  try {
    const { id } = parseParamsOrError(shopIdParamSchema, params);
    const { token } = parseQueryOrError(registrationQuerySchema, url);

    // Validate machine authentication
    await validateMachineAuth(request, id);

    // Get registration from Redis
    await ensureConnected();
    const registrationStr = await redis.get(`${REGISTRATION_KEY_PREFIX}${token}`);

    if (!registrationStr) {
      error(404, m.registration_not_found_or_expired());
    }

    const registration: AttendanceRegistration = JSON.parse(registrationStr);

    // Verify the registration belongs to this shop
    if (registration.shopId !== id.toString()) {
      error(403, m.access_denied());
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

    const response = attendanceRegistrationGetResponseSchema.parse(
      toPlainObject({
        success: true,
        registration: user
          ? { ...registration, alreadyInQueue, user: protect(user) }
          : { ...registration, alreadyInQueue }
      })
    );

    return json(response);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error getting registration:', err);
    error(500, m.failed_to_get_registration());
  }
};

export const DELETE: RequestHandler = async ({ params, request, url }) => {
  try {
    const { id } = parseParamsOrError(shopIdParamSchema, params);
    const { token } = parseQueryOrError(registrationQuerySchema, url);

    // Validate machine authentication
    await validateMachineAuth(request, id);

    // Delete registration from Redis
    await ensureConnected();
    const deleted = await redis.del(`${REGISTRATION_KEY_PREFIX}${token}`);

    if (deleted === 0) {
      error(404, m.registration_not_found_or_expired());
    }

    const response = successResponseSchema.parse({ success: true });

    return json(response);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error deleting registration:', err);
    error(500, m.failed_to_delete_registration());
  }
};

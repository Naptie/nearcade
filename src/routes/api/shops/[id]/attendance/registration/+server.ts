import { error, json, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import type { Machine, AttendanceRegistration, Shop } from '$lib/types';
import { m } from '$lib/paraglide/messages';
import { nanoid } from 'nanoid';
import type { User } from '$lib/auth/types';
import { protect } from '$lib/utils';
import { attendanceRegistrationRequestSchema } from '$lib/schemas/shop';
import { validationMessage } from '$lib/schemas/common';

const REGISTRATION_KEY_PREFIX = 'nearcade:registration:';
const MAX_EXPIRATION_SECONDS = 2 * 60; // 2 minutes

// Helper to validate machine API secret and check shop binding
const validateMachineAuth = async (request: Request, shopId: number): Promise<Machine> => {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw error(401, m.unauthorized());
  }

  const apiSecret = authHeader.slice(7);
  const db = mongo.db();
  const machinesCollection = db.collection<Machine>('machines');

  const machine = await machinesCollection.findOne({
    apiSecret,
    isActivated: true
  });

  if (!machine) {
    throw error(401, m.invalid_machine_credentials());
  }

  // Validate machine is bound to the correct shop
  if (machine.shopId !== shopId) {
    throw error(403, m.machine_not_bound_to_shop());
  }

  return machine;
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const idRaw = params.id;
    const id = parseInt(idRaw);

    if (isNaN(id)) {
      error(400, m.invalid_shop_id());
    }

    // Validate machine authentication
    const machine = await validateMachineAuth(request, id);

    const rawBody = await request.json().catch(() => null);
    if (rawBody === null) {
      error(400, 'Invalid request body');
    }

    const parsedBody = attendanceRegistrationRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      error(400, validationMessage(parsedBody.error.issues, m.missing_required_parameters()));
    }

    const { slotIndex, expires } = parsedBody.data;

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

    return json({
      success: true,
      token,
      expiresAt: registration.expiresAt,
      shopName: shop?.name || null
    });
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
    const idRaw = params.id;
    const id = parseInt(idRaw);
    const token = url.searchParams.get('token');

    if (isNaN(id)) {
      error(400, m.invalid_shop_id());
    }

    if (!token) {
      error(400, m.missing_required_parameters());
    }

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
    if (registration.userId) {
      const db = mongo.db();
      const usersCollection = db.collection<User>('users');
      user = (await usersCollection.findOne({ id: registration.userId })) ?? undefined;
    }

    return json({
      success: true,
      registration: user ? { ...registration, user: protect(user) } : registration
    });
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
    const idRaw = params.id;
    const id = parseInt(idRaw);
    const token = url.searchParams.get('token');

    if (isNaN(id)) {
      error(400, m.invalid_shop_id());
    }

    if (!token) {
      error(400, m.missing_required_parameters());
    }

    // Validate machine authentication
    await validateMachineAuth(request, id);

    // Delete registration from Redis
    await ensureConnected();
    const deleted = await redis.del(`${REGISTRATION_KEY_PREFIX}${token}`);

    if (deleted === 0) {
      error(404, m.registration_not_found_or_expired());
    }

    return json({ success: true });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error deleting registration:', err);
    error(500, m.failed_to_delete_registration());
  }
};

import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import redis, { ensureConnected } from '$lib/db/redis.server';
import mongo from '$lib/db/index.server';
import type { AttendanceRegistration, Shop } from '$lib/types';
import { ShopSource } from '$lib/constants';
import { m } from '$lib/paraglide/messages';

const REGISTRATION_KEY_PREFIX = 'nearcade:registration:';

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const { source: sourceRaw, id } = params;
  const source = sourceRaw.toLowerCase().trim();
  const token = url.searchParams.get('token');

  // Validate source
  if (!Object.values(ShopSource).includes(source as ShopSource)) {
    error(404, m.invalid_shop_source());
  }

  // Validate id
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(404, m.invalid_shop_id());
  }

  // Token is required
  if (!token) {
    error(400, m.missing_required_parameters());
  }

  // Check login status
  const session = await locals.auth();

  if (!session?.user) {
    // Redirect to login with return URL
    const returnUrl = url.pathname + url.search;
    redirect(302, `/session?callbackUrl=${encodeURIComponent(returnUrl)}`);
  }

  // Get registration from Redis
  await ensureConnected();
  const registrationStr = await redis.get(`${REGISTRATION_KEY_PREFIX}${token}`);

  if (!registrationStr) {
    // Token expired or invalid
    return {
      status: 'error' as const,
      errorCode: 'expired_or_invalid',
      shop: null,
      slotIndex: null
    };
  }

  const registration: AttendanceRegistration = JSON.parse(registrationStr);

  // Verify the registration belongs to this shop
  if (registration.shopSource !== source || registration.shopId !== shopId.toString()) {
    return {
      status: 'error' as const,
      errorCode: 'invalid_shop',
      shop: null,
      slotIndex: null
    };
  }

  // Check if already registered
  if (registration.userId) {
    return {
      status: 'error' as const,
      errorCode: 'already_registered',
      shop: null,
      slotIndex: registration.slotIndex
    };
  }

  // Store the user ID in the registration
  registration.userId = session.user.id;

  // Calculate remaining TTL
  const expiresAt = new Date(registration.expiresAt);
  const ttlMs = expiresAt.getTime() - Date.now();

  if (ttlMs <= 0) {
    // Token has expired
    await redis.del(`${REGISTRATION_KEY_PREFIX}${token}`);
    return {
      status: 'error' as const,
      errorCode: 'expired_or_invalid',
      shop: null,
      slotIndex: null
    };
  }

  // Update Redis with userId
  const ttlSeconds = Math.ceil(ttlMs / 1000);
  await redis.setEx(`${REGISTRATION_KEY_PREFIX}${token}`, ttlSeconds, JSON.stringify(registration));

  // Get shop details
  const db = mongo.db();
  const shop = await db.collection<Shop>('shops').findOne({
    source: source as ShopSource,
    id: shopId
  });

  return {
    status: 'success' as const,
    errorCode: null,
    shop: shop ? { name: shop.name, source: shop.source, id: shop.id } : null,
    slotIndex: registration.slotIndex
  };
};

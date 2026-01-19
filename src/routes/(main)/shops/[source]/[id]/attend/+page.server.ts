import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import redis, { ensureConnected } from '$lib/db/redis.server';
import mongo from '$lib/db/index.server';
import type { AttendanceRegistration, Shop } from '$lib/types';
import { ShopSource } from '$lib/constants';
import { m } from '$lib/paraglide/messages';
import { loginRedirect } from '$lib/utils/scoped';

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
    throw loginRedirect(url);
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

  // Get shop details
  const db = mongo.db();
  const shop = await db.collection<Shop>('shops').findOne({
    source: source as ShopSource,
    id: shopId
  });

  // Check if already registered
  if (registration.userId && registration.userId !== session.user.id) {
    return {
      status: 'error' as const,
      errorCode: 'already_registered',
      shop: shop ? { name: shop.name, source: shop.source, id: shop.id } : null,
      slotIndex: registration.slotIndex
    };
  }

  // Store the user ID in the registration
  registration.userId = session.user.id;

  // Update Redis with userId
  await redis.setEx(`${REGISTRATION_KEY_PREFIX}${token}`, 5 * 60, JSON.stringify(registration));

  return {
    status: 'success' as const,
    errorCode: null,
    shop: shop ? { name: shop.name, source: shop.source, id: shop.id } : null,
    slotIndex: registration.slotIndex
  };
};

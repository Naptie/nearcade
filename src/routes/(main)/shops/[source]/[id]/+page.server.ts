import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import client from '$lib/db/index.server';
import { ShopSource } from '$lib/constants';

export const load: PageServerLoad = async ({ params, parent, fetch }) => {
  const { source, id } = params;

  // Validate source
  if (!Object.values(ShopSource).includes(source as ShopSource)) {
    error(404, 'Invalid shop source');
  }

  // Validate id
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(404, 'Invalid shop ID');
  }

  try {
    const db = client.db();
    const shopsCollection = db.collection<Shop>('shops');

    // Find the shop by source and id
    const shop = await shopsCollection.findOne({
      source: source as ShopSource,
      id: shopId
    });

    if (!shop) {
      error(404, 'Shop not found');
    }

    const { session } = await parent();

    // Load attendance data
    let attendanceData = {};
    try {
      const attendanceResponse = await fetch(`/api/attendance?shopSource=${source}&shopId=${id}`);
      if (attendanceResponse.ok) {
        const attendanceResult = await attendanceResponse.json() as { attendanceData?: Record<string, unknown> };
        attendanceData = attendanceResult.attendanceData || {};
      }
    } catch (err) {
      console.warn('Failed to load attendance data:', err);
    }

    return {
      shop: toPlainObject(shop),
      attendanceData,
      user: session?.user
    };
  } catch (err) {
    console.error('Error loading shop:', err);
    error(500, 'Failed to load shop');
  }
};

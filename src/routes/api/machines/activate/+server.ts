import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Machine, Shop } from '$lib/types';
import { nanoid } from 'nanoid';
import { m } from '$lib/paraglide/messages';

export const POST: RequestHandler = async ({ url }) => {
  const serialNumber = url.searchParams.get('sn');

  if (!serialNumber) {
    error(400, m.missing_required_parameters());
  }

  const db = mongo.db();
  const machinesCollection = db.collection<Machine>('machines');
  const shopsCollection = db.collection<Shop>('shops');

  // Find the machine by serial number
  const machine = await machinesCollection.findOne({ serialNumber });

  if (!machine) {
    error(404, m.machine_not_found());
  }

  if (machine.isActivated) {
    error(400, m.machine_already_activated());
  }

  // Generate API secret
  const apiSecret = nanoid(32);

  // Update the machine to mark it as activated and store the API secret
  await machinesCollection.updateOne(
    { id: machine.id },
    {
      $set: {
        isActivated: true,
        apiSecret,
        updatedAt: new Date()
      }
    }
  );

  // Mark the shop as claimed
  await shopsCollection.updateOne(
    { source: machine.shopSource, id: machine.shopId },
    {
      $set: {
        isClaimed: true,
        updatedAt: new Date()
      }
    }
  );

  // Fetch the shop details to return
  const shop = await shopsCollection.findOne({
    source: machine.shopSource,
    id: machine.shopId
  });

  return json({
    success: true,
    apiSecret,
    shop: shop
      ? {
          source: shop.source,
          id: shop.id,
          name: shop.name
        }
      : null
  });
};

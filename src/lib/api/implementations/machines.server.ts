import { implement } from '@orpc/server';
import { nanoid } from 'nanoid';
import { machinesContract } from '../contracts/machines';
import type { ApiContext } from '../context';
import { apiError, toWire } from '../errors';
import mongo from '$lib/db/index.server';
import { syncShopDocument } from '$lib/db/meili.server';
import { API_TOKEN_PREFIX } from '$lib/api-tokens';
import { sha256Hex } from '$lib/hash';
import type { Machine, Shop } from '$lib/types';
import { m } from '$lib/paraglide/messages';
import { activateMachineResponseSchema } from '$lib/schemas/machines';

const impl = implement(machinesContract).$context<ApiContext>();

export const machinesImplementation = {
  /** `POST /api/machines/activate` */
  activate: impl.activate.handler(async ({ input }) => {
    const { sn: serialNumber } = input.query;

    const db = mongo.db();
    const machinesCollection = db.collection<Machine>('machines');
    const shopsCollection = db.collection<Shop>('shops');

    // Find the machine by serial number
    const machine = await machinesCollection.findOne({ serialNumber });

    if (!machine) {
      apiError('NOT_FOUND', m.machine_not_found());
    }

    if (machine.isActivated) {
      apiError('BAD_REQUEST', m.machine_already_activated());
    }

    // Generate API secret. Only its digest is stored — the response below is
    // the one time the secret itself is ever returned.
    const apiSecret = `${API_TOKEN_PREFIX}${nanoid(32)}`;

    // Update the machine to mark it as activated and store the API secret
    await machinesCollection.updateOne(
      { id: machine.id },
      {
        $set: {
          isActivated: true,
          apiSecretHash: sha256Hex(apiSecret),
          updatedAt: new Date()
        }
      }
    );

    // Mark the shop as claimed and set ownerId from the machine
    await shopsCollection.updateOne(
      { id: machine.shopId },
      {
        $set: {
          isClaimed: true,
          ...(machine.ownerId ? { ownerId: machine.ownerId } : {}),
          updatedAt: new Date()
        }
      }
    );

    // Fetch the shop details to return
    const shop = await shopsCollection.findOne({
      id: machine.shopId
    });

    if (shop) {
      try {
        await syncShopDocument(shop);
      } catch (meiliErr) {
        console.error('Failed to sync updated shop to Meilisearch:', meiliErr);
      }
    }

    return toWire(activateMachineResponseSchema, {
      success: true,
      apiSecret,
      shop: shop
        ? {
            id: shop.id,
            name: shop.name
          }
        : null
    });
  })
};

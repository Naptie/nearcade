import { error, json, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Machine, QueueRecord, Shop, QueuePosition } from '$lib/types';
import { ShopSource } from '$lib/constants';
import { m } from '$lib/paraglide/messages';
import { toPlainArray } from '$lib/utils';
import type { User } from '@auth/sveltekit';

// Helper to validate machine API secret and check shop binding
const validateMachineAuth = async (
  request: Request,
  shopSource: ShopSource,
  shopId: number
): Promise<Machine> => {
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
  if (machine.shopSource !== shopSource || machine.shopId !== shopId) {
    throw error(403, m.machine_not_bound_to_shop());
  }

  return machine;
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const source = params.source.toLowerCase().trim() as ShopSource;
    const idRaw = params.id;
    const id = parseInt(idRaw);

    // Validate shop source
    if (!Object.values(ShopSource).includes(source)) {
      error(400, m.invalid_shop_source());
    }

    if (isNaN(id)) {
      error(400, m.invalid_shop_id());
    }

    // Validate machine authentication and shop binding
    const machine = await validateMachineAuth(request, source, id);

    const body = (await request.json()) as {
      gameId: number;
      queue: QueuePosition[];
    };

    const { gameId, queue } = body;

    if (typeof gameId !== 'number' || !Array.isArray(queue)) {
      error(400, m.missing_required_parameters());
    }

    // Validate queue structure
    for (const position of queue) {
      if (
        typeof position.position !== 'number' ||
        !['playing', 'queued', 'deferred'].includes(position.status) ||
        !Array.isArray(position.members)
      ) {
        error(400, m.invalid_queue_format());
      }

      for (const member of position.members) {
        if (
          typeof member.slotIndex !== 'string' ||
          (member.userId !== null && typeof member.userId !== 'string')
        ) {
          error(400, m.invalid_queue_format());
        }
      }
    }

    // Verify shop exists and has the game
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');
    const shop = await shopsCollection.findOne({ source, id });

    if (!shop) {
      error(404, m.shop_not_found());
    }

    if (!shop.games.some((g) => g.gameId === gameId)) {
      error(404, m.games_missing_in_shop());
    }

    // Upsert queue record (one record per game per shop)
    const queuesCollection = db.collection<QueueRecord>('queues');

    await queuesCollection.updateOne(
      { shopSource: source, shopId: id, gameId },
      {
        $set: {
          queue,
          updatedAt: new Date(),
          updatedByMachineId: machine.id
        },
        $setOnInsert: {
          shopSource: source,
          shopId: id,
          gameId
        }
      },
      { upsert: true }
    );

    return json({ success: true });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error updating queue:', err);
    error(500, m.failed_to_update_queue());
  }
};

export const GET: RequestHandler = async ({ params }) => {
  try {
    const source = params.source.toLowerCase().trim() as ShopSource;
    const idRaw = params.id;
    const id = parseInt(idRaw);

    // Validate shop source
    if (!Object.values(ShopSource).includes(source)) {
      error(400, m.invalid_shop_source());
    }

    if (isNaN(id)) {
      error(400, m.invalid_shop_id());
    }

    const db = mongo.db();
    const queuesCollection = db.collection<QueueRecord>('queues');
    const usersCollection = db.collection<User>('users');

    // Get all queues for this shop
    const queues = await queuesCollection.find({ shopSource: source, shopId: id }).toArray();

    // Collect all user IDs from queues
    const userIds = new Set<string>();
    for (const queue of queues) {
      for (const position of queue.queue) {
        for (const member of position.members) {
          if (member.userId) {
            userIds.add(member.userId);
          }
        }
      }
    }

    // Fetch user data
    const users =
      userIds.size > 0
        ? await usersCollection
            .find(
              { id: { $in: Array.from(userIds) } },
              { projection: { id: 1, name: 1, displayName: 1, image: 1 } }
            )
            .toArray()
        : [];

    const userMap = new Map(users.map((u) => [u.id, u]));

    // Enrich queue data with user info
    const enrichedQueues = queues.map((queue) => ({
      ...queue,
      queue: queue.queue.map((position) => ({
        ...position,
        members: position.members.map((member) => ({
          ...member,
          user: member.userId ? userMap.get(member.userId) || null : null
        }))
      }))
    }));

    return json({
      success: true,
      queues: toPlainArray(enrichedQueues)
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error getting queues:', err);
    error(500, m.failed_to_get_queues());
  }
};

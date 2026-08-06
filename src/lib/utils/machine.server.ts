import { error } from '@sveltejs/kit';
import mongo from '$lib/db/index.server';
import type { Machine, QueueRecord } from '$lib/types';
import { m } from '$lib/paraglide/messages';

export const MACHINE_API_SECRET_PREFIX = 'nk_';

// Validate machine API secret and check shop binding
export const validateMachineAuth = async (request: Request, shopId: number): Promise<Machine> => {
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

/**
 * Whether the given user currently occupies a card slot in any shop's machine
 * queue. Machines report full queue snapshots to the `queues` collection, so a
 * single query across every shop is enough to enforce "one account = one card
 * slot" globally.
 */
export const isUserQueued = async (userId: string): Promise<boolean> => {
  const db = mongo.db();
  const queuesCollection = db.collection<QueueRecord>('queues');
  const record = await queuesCollection.findOne(
    { 'games.queue.members.userId': userId },
    { projection: { _id: 1 } }
  );
  return record !== null;
};

import { error } from '@sveltejs/kit';
import mongo from '$lib/db/index.server';
import type { Machine } from '$lib/types';
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

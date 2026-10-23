import { error } from '@sveltejs/kit';
import mongo from '$lib/db/index.server';
import type { Machine } from '$lib/types';
import type { QueueRecord } from '$lib/types/index.server';
import { m } from '$lib/paraglide/messages';
import { API_TOKEN_PREFIX } from '$lib/api-tokens';

/**
 * Whether the request presents an API token.
 *
 * The token may be a machine's secret or one the user minted; which one it is
 * is settled by the lookup that follows.
 */
const presentsApiToken = (request: Request): boolean => {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  return authHeader.slice(7).startsWith(API_TOKEN_PREFIX);
};

/**
 * The activated machine a request's bearer secret belongs to, if any.
 *
 * The lookup is split out of {@link validateMachineAuth} so the API guard can
 * verify the credential without the shop binding — the guard runs before the
 * request body is validated, so it cannot know which shop the machine is
 * acting for. The handler performs that half.
 */
export const findMachineByApiSecret = async (request: Request): Promise<Machine | null> => {
  if (!presentsApiToken(request)) {
    return null;
  }

  const apiSecret = request.headers.get('Authorization')!.slice(7);
  const db = mongo.db();
  const machinesCollection = db.collection<Machine>('machines');

  return machinesCollection.findOne({ apiSecret, isActivated: true });
};

// Validate machine API secret and check shop binding
export const validateMachineAuth = async (request: Request, shopId: number): Promise<Machine> => {
  const machine = await findMachineByApiSecret(request);

  if (!machine) {
    // The request carried no bearer secret at all, or it names no activated
    // machine. Both are an authentication failure for the same reason.
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw error(401, m.unauthorized());
    }
    throw error(401, m.invalid_machine_credentials());
  }

  // Validate machine is bound to the correct shop
  if (machine.shopId !== shopId) {
    throw error(403, m.machine_not_bound_to_shop());
  }

  return machine;
};

/**
 * The Redis key of a kiosk registration token.
 *
 * The kiosk mints the token, the attend page claims it, and the kiosk reads it
 * back — five call sites across two modules. The format is written once here so
 * a change cannot leave the writer and the readers disagreeing about the key.
 */
export const registrationKey = (token: string) => `nearcade:registration:${token}`;

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

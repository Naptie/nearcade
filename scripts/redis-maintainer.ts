import { createClient } from 'redis';
import { MongoClient, ObjectId } from 'mongodb';

if (!('MONGODB_URI' in process.env)) {
  const dotenv = await import('dotenv');
  dotenv.config();
}

const { REDIS_URI, MONGODB_URI, QBIND_KEY_PREFIX } = process.env;

const mongo = new MongoClient(MONGODB_URI!);

// --- shared config ----------------------------------------------------------

const QBIND_DEFAULT_PREFIX = 'nearcade';
// Long-lived processes in this project (this maintainer and the app itself)
// must agree on the same Redis keyspace-notification flags. Setting only
// "K$" here would clobber the "xE"/"Ex" flags another consumer needs, and
// vice versa — so flags are merged with whatever is already configured and
// re-asserted on every connection.
const NOTIFICATION_FLAGS = ['K', '$', 'E', 'x'];

/**
 * Merges the flags this maintainer needs (keyspace string events for qbind,
 * expired events for attendance) into `notify-keyspace-events` on every
 * (re)connect, preserving any flags other services already set.
 */
const ensureNotifyKeyspaceEvents = async (client: ReturnType<typeof createClient>) => {
  try {
    const current = await client.configGet('notify-keyspace-events');
    const existing = Object.values(current)[0] ?? '';
    const merged = [...new Set([...existing, ...NOTIFICATION_FLAGS])];
    if (merged.join('') !== existing) {
      await client.configSet('notify-keyspace-events', merged.join(''));
    }
  } catch (err) {
    console.warn('[Maintainer] Could not configure Redis notifications:', err);
  }
};

// --- qbind binding ----------------------------------------------------------

const QBIND_TOKEN_TTL = 600;

const getQbindPrefix = () => `qbind:${QBIND_KEY_PREFIX?.trim() || QBIND_DEFAULT_PREFIX}:`;
const getQbindKey = (token: string) => `${getQbindPrefix()}${token}`;
const getQbindOwnerKey = (token: string) => `${getQbindKey(token)}:owner`;
const getQbindResultKey = (token: string) => `${getQbindKey(token)}:result`;

/**
 * Completes a qbind binding in the backend: claims the value key written by
 * the qbind bot (and the token→user mapping), writes the verified QQ social
 * link, and stores a result the frontend can poll. Binding then succeeds even
 * if the user never returns to the site.
 *
 * Claiming with GETDEL keeps this safe with the app's polling endpoint: only
 * one consumer wins, and re-claiming an already-completed token is a no-op.
 */
const completeQbindBinding = async (commandClient: ReturnType<typeof createClient>, token: string) => {
  try {
    const valueKey = getQbindKey(token);
    const raw = await commandClient.getDel(valueKey);
    if (!raw) return;

    const ownerKey = getQbindOwnerKey(token);
    const userId = await commandClient.getDel(ownerKey);
    if (!userId) return;

    const qq = parseInt(raw, 10);
    if (isNaN(qq) || qq <= 0) {
      console.error('[Maintainer] Invalid QQ for token:', token, raw);
      return;
    }

    const usersCollection = mongo.db().collection('users');
    const user = await usersCollection.findOne(
      { _id: new ObjectId(userId) },
      { projection: { socialLinks: 1 } }
    );

    const socialLinks = Array.isArray(user?.socialLinks) ? user.socialLinks : [];
    const verifiedLink = { platform: 'qq', username: String(qq), verified: true };
    const index = socialLinks.findIndex(
      (link: { platform: string }) => link.platform === 'qq'
    );
    if (index >= 0) {
      socialLinks[index] = verifiedLink;
    } else {
      socialLinks.push(verifiedLink);
    }

    await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { socialLinks, updatedAt: new Date() } }
    );

    await commandClient.setEx(getQbindResultKey(token), QBIND_TOKEN_TTL, JSON.stringify({ qq }));
    console.log(`[Maintainer] Bound QQ ${qq} to user ${userId} via token ${token}`);
  } catch (err) {
    console.error('[Maintainer] Failed to complete qbind binding:', err);
  }
};

const onQbindKeyWritten = (commandClient: ReturnType<typeof createClient>, channel: string, event: string) => {
  // React only to writes of the qbind value key itself (SET/SETEX); ignore
  // del/expiry events and the maintainer's own owner/result keys.
  if (event !== 'set' && event !== 'setex') return;
  const key = channel.split('__:')[1] ?? '';
  const prefix = getQbindPrefix();
  if (!key.startsWith(prefix)) return;
  const token = key.slice(prefix.length);
  if (!token || token.includes(':')) return;
  void completeQbindBinding(commandClient, token);
};

// --- attendance expiration --------------------------------------------------

const handleAttendanceExpiration = async (expiredKey: string) => {
  try {
    console.log('[Attendance] Processing key:', expiredKey);

    // Parse the key to extract shop and user information
    // Key format: nearcade:attend:${source}-${id}:${userId}:${attendedAt}:${gameId},...
    const keyParts = expiredKey.split(':');
    if (keyParts.length !== 6) {
      console.error('[Attendance] Invalid key format:', expiredKey);
      return;
    }

    const shopPart = keyParts[2]; // source-id
    const userId = keyParts[3];
    const attendedAt = decodeURIComponent(keyParts[4]);
    const games = keyParts[5].split(',').map((g) => parseInt(g)); // gameId

    const shopInfo = shopPart.split('-');
    if (shopInfo.length < 2) {
      console.error('[Attendance] Invalid shop info in key:', expiredKey);
      return;
    }

    const source = shopInfo[0];
    const id = parseInt(shopInfo.slice(1).join('-')); // Handle sources with dashes

    if (isNaN(id)) {
      console.error('[Attendance] Invalid shop ID in key:', expiredKey);
      return;
    }

    const db = mongo.db();
    const shopsCollection = db.collection('shops');
    const shop = await shopsCollection.findOne({ id, source });

    const attendanceData = {
      games: games.map((gameId) => {
        const game = shop?.games.find((g: { gameId: number }) => g.gameId === gameId);
        return {
          gameId,
          name: game.name,
          version: game.version
        };
      }),
      attendedAt: new Date(attendedAt).toISOString(),
      plannedLeaveAt: new Date().toISOString() // Now
    };

    // Add to MongoDB attendances collection
    const attendancesCollection = db.collection('attendances');

    await attendancesCollection.insertOne({
      userId,
      games: attendanceData.games || [],
      shop: {
        id,
        source
      },
      attendedAt: new Date(attendanceData.attendedAt),
      leftAt: new Date(attendanceData.plannedLeaveAt)
    });

    console.log(`[Attendance] Record created for key: ${expiredKey}`);
  } catch (error) {
    console.error('[Attendance] Error:', error);
  }
};

// --- main -------------------------------------------------------------------

if (!REDIS_URI) {
  console.error('REDIS_URI is required');
  process.exit(1);
}

// One connection for commands (CONFIG, GETDEL, SETEX), one for the
// subscriptions — a client in subscriber mode cannot run commands.
const commandClient = createClient({ url: REDIS_URI });
const subscriberClient = createClient({ url: REDIS_URI });

commandClient.on('error', (err) => {
  console.error('[Maintainer] Command client error:', err);
});

const startSubscriber = async () => {
  try {
    await commandClient.connect();
    await subscriberClient.connect();

    // Re-assert the merged notification flags on every (re)connect. The
    // subscriptions themselves are restored automatically by the client.
    subscriberClient.on('ready', async () => {
      await ensureNotifyKeyspaceEvents(commandClient);
    });

    // Keyspace-expired events drive attendance recording.
    await subscriberClient.subscribe('__keyevent@0__:expired', async (message) => {
      if (message.startsWith('nearcade:attend:')) {
        await handleAttendanceExpiration(message);
      }
    });

    // Keyspace string events on qbind keys drive QQ binding completion.
    await subscriberClient.pSubscribe('__keyspace@*__:qbind:*', (event, channel) => {
      onQbindKeyWritten(commandClient, channel, event);
    });

    console.log('[Maintainer] Redis subscriber started (attendance + qbind)');
  } catch (error) {
    console.error('[Maintainer] Failed to start subscriber:', error);
    throw error;
  }
};

// Gracefully shutdown the subscriber
const stopSubscriber = async () => {
  if (subscriberClient) {
    await subscriberClient.pUnsubscribe();
    await subscriberClient.unsubscribe();
    await subscriberClient.close();
    console.log('[Maintainer] Redis subscriber stopped');
  }
  if (commandClient) {
    await commandClient.close();
  }
};

try {
  await startSubscriber();
} catch (err) {
  console.error('[Maintainer] Fatal error:', err);
  await stopSubscriber();
  process.exit(1);
}
import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import redis from '$lib/db/redis.server';
import type {
  AttendanceData,
  AttendanceRecord,
  AttendanceReport,
  AttendanceReportRecord,
  Shop
} from '$lib/types';
import { getShopOpeningHours, protect } from '$lib/utils';
import { ShopSource } from '$lib/constants';
import type { User } from '@auth/sveltekit';
import { getCurrentAttendance } from '$lib/utils/index.server';
import { m } from '$lib/paraglide/messages';

const attend = async (
  user: User,
  shop: Shop,
  data: {
    games: {
      id: number;
    }[];
    attendedAt: Date;
    plannedLeaveAt: Date;
  }
) => {
  const { source, id } = shop;
  const { games, attendedAt, plannedLeaveAt } = data;
  const attendanceKey = `nearcade:attend:${source}-${id}:${user.id}:${encodeURIComponent(attendedAt.toISOString())}:${games.map((g) => g.id).join(',')}`;
  const attendanceData = {
    games,
    attendedAt: attendedAt.toISOString(),
    plannedLeaveAt: plannedLeaveAt.toISOString()
  };

  // Calculate TTL in seconds
  const plannedLeave = plannedLeaveAt.getTime();
  const ttlSeconds = Math.max(Math.floor((plannedLeave - Date.now()) / 1000), 60); // Minimum 60 seconds

  // Store attendance in Redis with expiration
  await redis.setEx(attendanceKey, ttlSeconds, JSON.stringify(attendanceData));
};

const leave = async (user: User, shop: Shop) => {
  const { source, id } = shop;
  const pattern = `nearcade:attend:${source}-${id}:${user.id}:*`;
  const keys = await redis.keys(pattern);
  if (keys.length === 0) {
    error(404, 'Attendance not found');
  }

  // Only one active attendance per user per shop
  const attendanceKey = keys[0];

  // Get the attendance data before deleting
  const attendanceDataStr = await redis.get(attendanceKey);
  if (!attendanceDataStr) {
    error(404, 'Attendance not found');
  }

  const attendanceData = JSON.parse(attendanceDataStr);

  // Delete from Redis
  await redis.del(attendanceKey);

  // Add to MongoDB attendances collection
  const db = mongo.db();
  const attendancesCollection = db.collection<AttendanceRecord>('attendances');

  await attendancesCollection.insertOne({
    userId: user.id!,
    games: attendanceData.games.map((game: { id: number }) => {
      const shopGame = shop?.games.find((g) => g.gameId === game.id);
      return {
        gameId: game.id,
        name: shopGame ? shopGame.name : 'Unknown Game',
        version: shopGame ? shopGame.version : ''
      };
    }),
    shop: {
      id,
      source
    },
    attendedAt: new Date(attendanceData.attendedAt),
    leftAt: new Date() // Actual leave time
  });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const session = await locals.auth();
  let user = session?.user;
  let attendingUser = null;
  let isOpenApiAccess = false;
  let isClaimedShopAccess = false;
  let isAttendingOnBehalf = false;

  if (!user) {
    const header = request.headers.get('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      error(401, m.unauthorized());
    }
    const token = header.slice(7);
    const agentToken = token.split('/')[0];
    const userToken = token === agentToken ? null : token.split('/')[1];
    const db = mongo.db();
    const usersCollection = db.collection<User>('users');
    const dbUser = await usersCollection.findOne({
      apiTokens: { $elemMatch: { token: agentToken, expiresAt: { $gt: new Date() } } }
    });
    if (!dbUser) {
      error(401, m.unauthorized());
    }
    const matchedToken = dbUser.apiTokens?.find((t) => t.token === agentToken);
    if (
      matchedToken?.shop &&
      matchedToken.shop.id.toString() !== params.id &&
      matchedToken.shop.source !== params.source
    ) {
      error(403, 'Forbidden');
    }
    isOpenApiAccess = true;
    isClaimedShopAccess = matchedToken?.shop ? true : false;
    user = dbUser;
    if (userToken) {
      attendingUser = await usersCollection.findOne({
        apiTokens: { $elemMatch: { token: userToken, expiresAt: { $gt: new Date() } } }
      });
      if (!attendingUser) {
        error(404, 'Target user not found');
      }
      isAttendingOnBehalf = true;
    }
  }

  try {
    const body = (await request.json()) as {
      games: { id: number; currentAttendances?: number; attend?: boolean }[];
      plannedLeaveAt?: string;
      comment?: string;
    };
    const { games, plannedLeaveAt, comment } = body;

    // Validate input
    if (
      !games ||
      !Array.isArray(games) ||
      (games.every((g) => g.currentAttendances === undefined) && !plannedLeaveAt)
    ) {
      error(400, 'Missing required parameters');
    }

    const source = params.source as ShopSource;

    // Validate shop source
    if (!Object.values(ShopSource).includes(source)) {
      error(400, 'Invalid shop source');
    }

    const idRaw = params.id;
    const id = parseInt(idRaw);

    if (isNaN(id)) {
      error(400, 'Invalid shop ID');
    }

    // Validate shop exists
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');
    const shop = await shopsCollection.findOne({
      source,
      id
    });

    if (!shop) {
      error(404, 'Shop not found');
    }
    if ((isClaimedShopAccess && !shop.isClaimed) || (!isClaimedShopAccess && shop.isClaimed)) {
      error(403, 'Forbidden');
    }

    // Validate game exists in shop
    const shopGames = shop.games.filter((sg) => games.some((g) => g.id === sg.gameId));
    if (shopGames.length !== games.length) {
      error(404, 'Games missing in shop');
    }

    if (!redis) {
      error(500, 'Redis not available');
    }

    const now = Date.now();
    const { open, close } = getShopOpeningHours(shop);
    if (now < open.getTime() || now > close.getTime()) {
      error(400, 'Shop is currently closed');
    }

    if (!isOpenApiAccess && plannedLeaveAt) {
      // Check for existing attendance
      if (await getCurrentAttendance(user.id!)) {
        error(409, 'User already has an active attendance');
      }

      const plannedLeaveTime = new Date(plannedLeaveAt);

      if (
        plannedLeaveTime < new Date(Date.now() + 8 * 60 * 1000) ||
        plannedLeaveTime < open ||
        plannedLeaveTime > close
      ) {
        error(400, 'Invalid planned leave time');
      }

      await attend(user, shop, {
        games: shopGames.map((g) => ({
          id: g.gameId
        })),
        attendedAt: new Date(),
        plannedLeaveAt: plannedLeaveTime
      });

      if (!user.frequentingArcades?.some((a) => a.id === shop.id && a.source === shop.source)) {
        const attendancesCollection = db.collection<AttendanceRecord>('attendances');
        const count = await attendancesCollection.countDocuments({
          userId: user.id!,
          'shop.id': id,
          'shop.source': source
        });
        if (count + 1 >= (user.autoDiscovery?.attendanceThreshold ?? 2)) {
          const usersCollection = db.collection<User>('users');
          await usersCollection.updateOne(
            { id: user.id! },
            {
              $addToSet: {
                frequentingArcades: { id: shop.id, source: shop.source }
              },
              $set: { updatedAt: new Date() }
            }
          );
        }
      }
    } else if (games.some((g) => g.currentAttendances !== undefined)) {
      if (now < open.getTime() || now > close.getTime()) {
        error(400, 'Shop is currently closed');
      }
      for (const game of games) {
        if (
          game.currentAttendances === undefined ||
          typeof game.currentAttendances !== 'number' ||
          isNaN(game.currentAttendances) ||
          game.currentAttendances < 0
        ) {
          error(400, `Invalid current attendances for game ${game.id}`);
        }
        const attendanceKey = `nearcade:attend-report:${source}-${id}:${game.id}`;
        const attendanceData = {
          currentAttendances: game.currentAttendances,
          reportedBy: user.id,
          reportedAt: new Date().toISOString()
        };
        const ttlSeconds = Math.max(Math.floor((close.getTime() - now) / 1000), 60); // Minimum 60 seconds

        // Store attendance in Redis
        await redis.setEx(attendanceKey, ttlSeconds, JSON.stringify(attendanceData));

        if (
          isAttendingOnBehalf &&
          attendingUser &&
          'attend' in game &&
          typeof game.attend === 'boolean'
        ) {
          if (game.attend) {
            await attend(attendingUser, shop, {
              games: [{ id: game.id }],
              attendedAt: new Date(),
              plannedLeaveAt: close
            });
          } else {
            await leave(attendingUser, shop);
          }
        }
      }

      const attendanceReportsCollection =
        db.collection<AttendanceReportRecord>('attendance_reports');
      await attendanceReportsCollection.insertOne({
        shop: { id: shop.id, source: shop.source },
        games: games.map((game) => {
          const shopGame = shop.games.find((g) => g.gameId === game.id);
          return {
            gameId: game.id,
            name: shopGame ? shopGame.name : 'Unknown Game',
            version: shopGame ? shopGame.version : '',
            currentAttendances: game.currentAttendances || 0
          };
        }),
        comment: comment || null,
        reportedBy: user.id!,
        reportedAt: new Date()
      });
    }

    return json({ success: true });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error creating attendance:', err);
    error(500, 'Failed to create attendance');
  }
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  try {
    const source = params.source as ShopSource;

    // Validate shop source
    if (!Object.values(ShopSource).includes(source)) {
      error(400, 'Invalid shop source');
    }

    const idRaw = params.id;
    const id = parseInt(idRaw);

    if (isNaN(id)) {
      error(400, 'Invalid shop ID');
    }

    if (!redis) {
      error(500, 'Redis not available');
    }

    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');
    const shop = await shopsCollection.findOne({
      source,
      id
    });
    if (!shop) {
      error(404, 'Shop not found');
    }

    await leave(session.user, shop);

    return json({ success: true });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error removing attendance:', err);
    error(500, 'Failed to remove attendance');
  }
};

// GET endpoint to retrieve attendance data for a shop
export const GET: RequestHandler = async ({ params, url, locals }) => {
  try {
    const fetchRegistered = ['0', 'false'].includes(url.searchParams.get('reported') || 'false');
    const fetchReported = ['1', 'true'].includes(url.searchParams.get('reported') || 'true');
    const source = params.source as ShopSource;

    // Validate shop source
    if (!Object.values(ShopSource).includes(source)) {
      error(400, 'Invalid shop source');
    }

    const idRaw = params.id;
    const id = parseInt(idRaw);

    if (isNaN(id)) {
      error(400, 'Invalid shop ID');
    }

    if (!redis) {
      error(500, 'Redis not available');
    }

    const usersSet = new Set<string>();

    const registered: AttendanceData = [];
    const reported: AttendanceReport = [];

    if (fetchRegistered) {
      const pattern = `nearcade:attend:${source}-${id}:*`;
      const keys = await redis.keys(pattern);

      for (const key of keys) {
        const dataStr = await redis.get(key);
        if (dataStr) {
          const data = JSON.parse(dataStr);
          const keyParts = key.split(':');
          const userId = keyParts[3];
          data.games.forEach((game: { id: number }) => {
            registered.push({
              userId,
              gameId: game.id,
              attendedAt: data.attendedAt,
              plannedLeaveAt: data.plannedLeaveAt
            });
            usersSet.add(userId);
          });
        }
      }
    }

    if (fetchReported) {
      const pattern = `nearcade:attend-report:${source}-${id}:*`;
      const keys = await redis.keys(pattern);

      for (const key of keys) {
        const dataStr = await redis.get(key);
        if (dataStr) {
          const data = JSON.parse(dataStr);
          const keyParts = key.split(':');
          const gameId = keyParts[3];
          reported.push({
            gameId: parseInt(gameId),
            currentAttendances: data.currentAttendances,
            reportedBy: data.reportedBy,
            reportedAt: data.reportedAt
          });
          usersSet.add(data.reportedBy);
        }
      }
    }

    const db = mongo.db();
    const usersCollection = db.collection<User>('users');
    const users = await usersCollection.find({ id: { $in: Array.from(usersSet) } }).toArray();

    const session = await locals.auth();

    registered.forEach((entry) => {
      const user = users.find((u) => u.id === entry.userId) as User;
      if (
        session?.user?.userType === 'site_admin' ||
        session?.user?.id === user.id ||
        user.isFootprintPublic
      ) {
        entry.user = protect(user);
      } else {
        delete entry.userId;
      }
    });
    registered.sort((a, b) => new Date(b.attendedAt).getTime() - new Date(a.attendedAt).getTime());

    reported.forEach((entry) => {
      entry.reporter = protect(users.find((u) => u.id === entry.reportedBy)) as User;
    });
    reported.sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());

    const shopsCollection = db.collection<Shop>('shops');
    const shop = await shopsCollection.findOne({ id, source });
    const total = Math.round(
      shop?.games
        .map((g) => {
          const mostRecentReport = reported.filter((r) => r.gameId === g.gameId).at(0);
          const reportedCount = mostRecentReport?.currentAttendances || 0;
          if (shop.isClaimed) return reportedCount;
          const registeredCount = registered
            .filter(
              (r) =>
                r.gameId === g.gameId &&
                (!mostRecentReport ||
                  new Date(r.attendedAt) > new Date(mostRecentReport.reportedAt))
            )
            .map((c) => 1 / registered.filter((r) => r.userId === c.userId).length)
            .reduce((a, b) => a + b, 0);
          return reportedCount + registeredCount;
        })
        .reduce((a, b) => a + b, 0) || 0
    );
    return json({ success: true, total, registered, reported });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error getting attendance:', err);
    error(500, 'Failed to get attendance');
  }
};

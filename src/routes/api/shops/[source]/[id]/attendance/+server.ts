import { error, isHttpError, json } from '@sveltejs/kit';
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

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const session = await locals.auth();
  let user = session?.user;
  let isOpenApiAccess = false;

  if (!user) {
    const header = request.headers.get('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      error(401, 'Unauthorized');
    }
    const token = header.slice(7);
    const db = mongo.db();
    const usersCollection = db.collection<User>('users');
    const dbUser = await usersCollection.findOne({ apiTokens: { $elemMatch: { token } } });
    if (!dbUser) {
      error(401, 'Unauthorized');
    }
    isOpenApiAccess = true;
    user = dbUser;
  }

  try {
    const body = (await request.json()) as {
      games: { id: number; currentAttendances?: number }[];
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

      const attendedAt = new Date().toISOString();
      const attendanceKey = `nearcade:attend:${source}-${id}:${user.id}:${encodeURIComponent(attendedAt)}:${shopGames.map((g) => g.gameId).join(',')}`;
      const attendanceData = {
        games: shopGames.map((g) => ({
          id: g.gameId
        })),
        attendedAt,
        plannedLeaveAt: plannedLeaveTime.toISOString()
      };

      // Calculate TTL in seconds
      const plannedLeave = plannedLeaveTime.getTime();
      const ttlSeconds = Math.max(Math.floor((plannedLeave - now) / 1000), 60); // Minimum 60 seconds

      // Store attendance in Redis with expiration
      await redis.setEx(attendanceKey, ttlSeconds, JSON.stringify(attendanceData));

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
        if (game.currentAttendances === undefined || game.currentAttendances < 0) {
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
        comment,
        reportedBy: user.id!,
        reportedAt: new Date()
      });
    }

    return json({ success: true });
  } catch (err) {
    if (err && isHttpError(err)) {
      throw err;
    }
    console.error('Error creating attendance:', err);
    error(500, 'Failed to create attendance');
  }
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, 'Unauthorized');
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

    const pattern = `nearcade:attend:${source}-${id}:${session.user.id}:*`;
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
    const shopsCollection = db.collection<Shop>('shops');
    const attendancesCollection = db.collection<AttendanceRecord>('attendances');

    const shop = await shopsCollection.findOne({ id, source });

    await attendancesCollection.insertOne({
      userId: session.user.id!,
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

    return json({ success: true });
  } catch (err) {
    console.error('Error removing attendance:', err);
    if (err && isHttpError(err)) {
      throw err;
    }
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
          const mostRecentReport = reported.filter((r) => r.gameId === g.gameId)[0];
          const reportedCount = mostRecentReport?.currentAttendances || 0;
          const registeredCount = registered
            .filter((r) => r.gameId === g.gameId)
            .map((c) => 1 / registered.filter((r) => r.userId === c.userId).length)
            .reduce((a, b) => a + b, 0);
          return Math.max(reportedCount, registeredCount);
        })
        .reduce((a, b) => a + b, 0) || 0
    );
    return json({ success: true, total, registered, reported });
  } catch (err) {
    if (err && isHttpError(err)) {
      throw err;
    }
    console.error('Error getting attendance:', err);
    error(500, 'Failed to get attendance');
  }
};

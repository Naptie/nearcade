import redis from '$lib/db/redis.server';
import mongo from '$lib/db/index.server';
import type { AttendanceData, AttendanceReport, Shop } from '$lib/types';
import type { User, Session } from '@auth/sveltekit';
import { protect } from '$lib/utils';
import type { ShopSource } from '$lib/constants';

export interface AttendanceDataOptions {
  fetchRegistered?: boolean;
  fetchReported?: boolean;
  session?: Session | null;
}

export interface ShopAttendanceResult {
  shopIdentifier: string; // format: "source-id"
  total: number;
  games: Array<{
    titleId: number;
    gameId: number;
    name: string;
    version: string;
    quantity: number;
    total: number;
  }>;
  registered: AttendanceData;
  reported: AttendanceReport;
}

/**
 * Calculate the total attendance for a shop based on reported and registered data
 * @param shop - The shop document from MongoDB
 * @param registered - Array of registered attendance data
 * @param reported - Array of reported attendance data
 * @returns The calculated total attendance rounded to nearest integer
 */
const calculateShopTotal = (
  shop: Shop,
  registered: AttendanceData,
  reported: AttendanceReport
): number => {
  return Math.round(
    shop.games
      .map((g) => {
        const mostRecentReport = reported.filter((r) => r.gameId === g.gameId).at(0);
        const reportedCount = mostRecentReport?.currentAttendances || 0;
        if (shop.isClaimed) return reportedCount;
        const registeredCount = registered
          .filter(
            (r) =>
              r.gameId === g.gameId &&
              (!mostRecentReport || new Date(r.attendedAt) > new Date(mostRecentReport.reportedAt))
          )
          .map((c) => 1 / registered.filter((r) => r.userId === c.userId).length)
          .reduce((a, b) => a + b, 0);
        return reportedCount + registeredCount;
      })
      .reduce((a, b) => a + b, 0) || 0
  );
};

/**
 * Get attendance data for multiple shops efficiently using Redis mGet
 * @param shops - Array of shop identifiers with source and id
 * @param options - Options to control what data to fetch
 * @returns Map of shop attendance data keyed by "source-id"
 */
export const getShopsAttendanceData = async (
  shops: Array<{ source: ShopSource; id: number }>,
  options: AttendanceDataOptions = {}
): Promise<Map<string, ShopAttendanceResult>> => {
  const { fetchRegistered = false, fetchReported = true, session = null } = options;

  if (!redis) {
    throw new Error('Redis not available');
  }
  if (!redis.isOpen) {
    await redis.connect();
  }

  const results = new Map<string, ShopAttendanceResult>();
  if (shops.length === 0) {
    return results;
  }

  // Initialize results for all shops
  for (const shop of shops) {
    const identifier = `${shop.source}-${shop.id}`;
    results.set(identifier, {
      shopIdentifier: identifier,
      total: 0,
      games: [],
      registered: [],
      reported: []
    });
  }

  const usersSet = new Set<string>();
  const allRegisteredKeys: string[] = [];
  const allReportedKeys: string[] = [];

  // Collect all keys for all shops
  if (fetchRegistered) {
    for (const shop of shops) {
      const pattern = `nearcade:attend:${shop.source}-${shop.id}:*`;
      const keys = await redis.keys(pattern);
      allRegisteredKeys.push(...keys);
    }
  }

  if (fetchReported) {
    for (const shop of shops) {
      const pattern = `nearcade:attend-report:${shop.source}-${shop.id}:*`;
      const keys = await redis.keys(pattern);
      allReportedKeys.push(...keys);
    }
  }

  // Fetch all registered attendance data using mGet
  if (allRegisteredKeys.length > 0) {
    const registeredValues = await redis.mGet(allRegisteredKeys);

    for (let i = 0; i < allRegisteredKeys.length; i++) {
      const key = allRegisteredKeys[i];
      const dataStr = registeredValues[i];

      if (dataStr) {
        const data = JSON.parse(dataStr);
        const keyParts = key.split(':');
        const shopIdentifier = keyParts[2]; // source-id format
        const userId = keyParts[3];

        const result = results.get(shopIdentifier);
        if (result) {
          data.games.forEach((game: { id: number }) => {
            result.registered.push({
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
  }

  // Fetch all reported attendance data using mGet
  if (allReportedKeys.length > 0) {
    const reportedValues = await redis.mGet(allReportedKeys);

    for (let i = 0; i < allReportedKeys.length; i++) {
      const key = allReportedKeys[i];
      const dataStr = reportedValues[i];

      if (dataStr) {
        const data = JSON.parse(dataStr);
        const keyParts = key.split(':');
        const shopIdentifier = keyParts[2]; // source-id format
        const gameId = keyParts[3];

        const result = results.get(shopIdentifier);
        if (result) {
          result.reported.push({
            gameId: parseInt(gameId),
            currentAttendances: data.currentAttendances,
            reportedBy: data.reportedBy,
            reportedAt: data.reportedAt,
            comment: data.comment ?? null
          });
          usersSet.add(data.reportedBy);
        }
      }
    }
  }

  // Fetch all users at once
  const db = mongo.db();
  const usersCollection = db.collection<User>('users');
  const users = await usersCollection.find({ id: { $in: Array.from(usersSet) } }).toArray();

  // Process user data for registered attendance
  for (const result of results.values()) {
    result.registered.forEach((entry) => {
      const user = users.find((u) => u.id === entry.userId) as User;
      if (
        session?.user?.userType === 'site_admin' ||
        session?.user?.id === user?.id ||
        user?.isFootprintPublic
      ) {
        entry.user = protect(user);
      } else {
        delete entry.userId;
      }
    });
    result.registered.sort(
      (a, b) => new Date(b.attendedAt).getTime() - new Date(a.attendedAt).getTime()
    );

    result.reported.forEach((entry) => {
      entry.reporter = protect(users.find((u) => u.id === entry.reportedBy)) as User;
    });
    result.reported.sort(
      (a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime()
    );
  }

  // Fetch shop data to calculate totals
  const shopsCollection = db.collection<Shop>('shops');
  const shopDocs = await shopsCollection
    .find({
      $or: shops.map((s) => ({ source: s.source, id: s.id }))
    })
    .toArray();

  // Calculate totals for each shop
  for (const shopDoc of shopDocs) {
    const identifier = `${shopDoc.source}-${shopDoc.id}`;
    const result = results.get(identifier);

    if (result) {
      result.total = calculateShopTotal(shopDoc, result.registered, result.reported);
      result.games = shopDoc.games.map((g) => {
        const mostRecentReport = result.reported.filter((r) => r.gameId === g.gameId).at(0);
        const reportedCount = mostRecentReport?.currentAttendances || 0;
        if (shopDoc.isClaimed)
          return {
            titleId: g.titleId,
            gameId: g.gameId,
            name: g.name,
            version: g.version,
            quantity: g.quantity,
            total: reportedCount
          };
        const registeredCount = result.registered.filter(
          (r) =>
            r.gameId === g.gameId &&
            (!mostRecentReport || new Date(r.attendedAt) > new Date(mostRecentReport.reportedAt))
        ).length;
        return {
          titleId: g.titleId,
          gameId: g.gameId,
          name: g.name,
          version: g.version,
          quantity: g.quantity,
          total: reportedCount + registeredCount
        };
      });
    }
  }

  if (redis.isOpen) {
    redis.quit();
  }

  return results;
};

/**
 * Get all shops with attendance data from Redis
 * Fetches all keys starting with nearcade:attend: and nearcade:attend-report: and calculates totals per game
 * @returns Map of shop identifiers to their game attendance totals
 */
export const getAllShopsAttendanceData = async (): Promise<
  Map<string, Array<{ gameId: number; total: number }>>
> => {
  if (!redis) {
    throw new Error('Redis not available');
  }
  if (!redis.isOpen) {
    await redis.connect();
  }

  const results = new Map<string, Array<{ gameId: number; total: number }>>();

  // Find all attend and attend-report keys
  const attendPattern = 'nearcade:attend:*';
  const reportPattern = 'nearcade:attend-report:*';
  const [attendKeys, reportKeys] = await Promise.all([
    redis.keys(attendPattern),
    redis.keys(reportPattern)
  ]);

  if (attendKeys.length === 0 && reportKeys.length === 0) {
    return results;
  }

  // Group registered attendance by shop identifier
  const shopRegistered = new Map<string, AttendanceData>();

  // Fetch all registered attendance data using mGet
  if (attendKeys.length > 0) {
    const attendValues = await redis.mGet(attendKeys);

    for (let i = 0; i < attendKeys.length; i++) {
      const key = attendKeys[i];
      const dataStr = attendValues[i];

      if (dataStr) {
        const data = JSON.parse(dataStr);
        const keyParts = key.split(':');
        const shopIdentifier = keyParts[2]; // source-id format
        const userId = keyParts[3];

        if (!shopRegistered.has(shopIdentifier)) {
          shopRegistered.set(shopIdentifier, []);
        }

        data.games.forEach((game: { id: number }) => {
          shopRegistered.get(shopIdentifier)!.push({
            userId,
            gameId: game.id,
            attendedAt: data.attendedAt,
            plannedLeaveAt: data.plannedLeaveAt
          });
        });
      }
    }
  }

  // Group reports by shop identifier
  const shopReports = new Map<string, AttendanceReport>();

  // Fetch all report data using mGet
  if (reportKeys.length > 0) {
    const reportValues = await redis.mGet(reportKeys);

    for (let i = 0; i < reportKeys.length; i++) {
      const key = reportKeys[i];
      const dataStr = reportValues[i];

      if (dataStr) {
        const data = JSON.parse(dataStr);
        const keyParts = key.split(':');
        const shopIdentifier = keyParts[2]; // source-id format
        const gameId = keyParts[3];

        if (!shopReports.has(shopIdentifier)) {
          shopReports.set(shopIdentifier, []);
        }

        shopReports.get(shopIdentifier)!.push({
          gameId: parseInt(gameId),
          currentAttendances: data.currentAttendances,
          reportedBy: data.reportedBy,
          reportedAt: data.reportedAt,
          comment: data.comment ?? null
        });
      }
    }
  }

  // Get all unique shop identifiers from both registered and reported data
  const allShopIdentifiers = new Set([...shopRegistered.keys(), ...shopReports.keys()]);

  // Fetch shop data from MongoDB to calculate totals
  const db = mongo.db();
  const shopsCollection = db.collection<Shop>('shops');

  // Parse shop identifiers to get source and id
  const shopIdentifiers = Array.from(allShopIdentifiers).map((identifier) => {
    const [source, id] = identifier.split('-');
    return { source: source as ShopSource, id: parseInt(id) };
  });

  const shopDocs = await shopsCollection
    .find({
      $or: shopIdentifiers.map((s) => ({ source: s.source, id: s.id }))
    })
    .toArray();

  // Calculate totals for each game in each shop
  for (const shopDoc of shopDocs) {
    const identifier = `${shopDoc.source}-${shopDoc.id}`;
    const registered = shopRegistered.get(identifier) || [];
    const reported = shopReports.get(identifier) || [];

    // Sort reports by date (most recent first) for accurate calculation
    reported.sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());

    const gameAttendances: Array<{ gameId: number; total: number }> = [];

    // Calculate total for each game
    for (const game of shopDoc.games) {
      const gameRegistered = registered.filter((r) => r.gameId === game.gameId);
      const gameReported = reported.filter((r) => r.gameId === game.gameId);

      const mostRecentReport = gameReported.at(0);
      const reportedCount = mostRecentReport?.currentAttendances || 0;

      let total: number;
      if (shopDoc.isClaimed) {
        total = reportedCount;
      } else {
        const registeredCount = gameRegistered
          .filter(
            (r) =>
              !mostRecentReport || new Date(r.attendedAt) > new Date(mostRecentReport.reportedAt)
          )
          .map((c) => 1 / registered.filter((r) => r.userId === c.userId).length)
          .reduce((a, b) => a + b, 0);
        total = reportedCount + registeredCount;
      }

      gameAttendances.push({
        gameId: game.gameId,
        total: Math.round(total)
      });
    }

    results.set(identifier, gameAttendances);
  }

  if (redis.isOpen) {
    redis.quit();
  }

  return results;
};

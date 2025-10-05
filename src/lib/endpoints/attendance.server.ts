import redis from '$lib/db/redis.server';
import mongo from '$lib/db/index.server';
import type { AttendanceData, AttendanceReport, Shop } from '$lib/types';
import type { User } from '@auth/sveltekit';
import { protect } from '$lib/utils';
import type { ShopSource } from '$lib/constants';

export interface AttendanceDataOptions {
  fetchRegistered?: boolean;
  fetchReported?: boolean;
  session?: { user?: any } | null;
}

export interface ShopAttendanceResult {
  shopIdentifier: string; // format: "source-id"
  total: number;
  registered: AttendanceData;
  reported: AttendanceReport;
}

/**
 * Get attendance data for multiple shops efficiently using Redis mGet
 * @param shops - Array of shop identifiers with source and id
 * @param options - Options to control what data to fetch
 * @returns Map of shop attendance data keyed by "source-id"
 */
export async function getShopsAttendanceData(
  shops: Array<{ source: ShopSource; id: number }>,
  options: AttendanceDataOptions = {}
): Promise<Map<string, ShopAttendanceResult>> {
  const { fetchRegistered = false, fetchReported = true, session = null } = options;

  if (!redis) {
    throw new Error('Redis not available');
  }

  const results = new Map<string, ShopAttendanceResult>();

  // Initialize results for all shops
  for (const shop of shops) {
    const identifier = `${shop.source}-${shop.id}`;
    results.set(identifier, {
      shopIdentifier: identifier,
      total: 0,
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
    result.registered.sort((a, b) => new Date(b.attendedAt).getTime() - new Date(a.attendedAt).getTime());

    result.reported.forEach((entry) => {
      entry.reporter = protect(users.find((u) => u.id === entry.reportedBy)) as User;
    });
    result.reported.sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());
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
      const total = Math.round(
        shopDoc.games
          .map((g) => {
            const mostRecentReport = result.reported.filter((r) => r.gameId === g.gameId).at(0);
            const reportedCount = mostRecentReport?.currentAttendances || 0;
            if (shopDoc.isClaimed) return reportedCount;
            const registeredCount = result.registered
              .filter(
                (r) =>
                  r.gameId === g.gameId &&
                  (!mostRecentReport ||
                    new Date(r.attendedAt) > new Date(mostRecentReport.reportedAt))
              )
              .map((c) => 1 / result.registered.filter((r) => r.userId === c.userId).length)
              .reduce((a, b) => a + b, 0);
            return reportedCount + registeredCount;
          })
          .reduce((a, b) => a + b, 0) || 0
      );
      result.total = total;
    }
  }

  return results;
}

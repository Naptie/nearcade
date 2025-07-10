import { json } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { error } from '@sveltejs/kit';
import { MongoClient } from 'mongodb';
import type { RequestHandler } from './$types';
import type {
  University,
  Shop,
  UniversityRankingData,
  RankingMetrics,
  SortCriteria,
  RadiusFilter,
  Location
} from '$lib/types';
import { calculateDistance, getGameMachineCount, calculateAreaDensity } from '$lib/utils';
import { GAMES, PAGINATION, RADIUS_OPTIONS } from '$lib/constants';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

// Cache duration: 1 day
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

interface CacheMetadata {
  _id: string;
  createdAt: Date;
  expiresAt: Date;
  totalCount: number;
  isCalculating?: boolean;
  calculationStarted?: Date;
}

interface CachedRanking extends UniversityRankingData {
  rankOrder: { [key: string]: number }; // sortBy_radius -> rank
}

const getShopsWithinRadius = async (
  shops: Shop[],
  center: Location,
  radiusKm: number
): Promise<Shop[]> => {
  return shops.filter((shop) => {
    const distance = calculateDistance(
      center.coordinates[1], // latitude
      center.coordinates[0], // longitude
      shop.location.coordinates[1], // latitude
      shop.location.coordinates[0] // longitude
    );
    return distance <= radiusKm;
  });
};

const calculateMetricsForRadius = (shops: Shop[], radiusKm: number): RankingMetrics => {
  const totalMachines = shops.reduce(
    (total, shop) => total + shop.games.reduce((gameTotal, game) => gameTotal + game.quantity, 0),
    0
  );

  return {
    radius: radiusKm,
    shopCount: shops.length,
    totalMachines,
    areaDensity: calculateAreaDensity(totalMachines, radiusKm),
    gameSpecificMachines: GAMES.map((game) => {
      const gameCount = getGameMachineCount(shops, game.id);
      return {
        name: game.key,
        quantity: gameCount
      };
    })
  };
};

const calculateAndCacheUniversityRankings = async (): Promise<void> => {
  const mongoClient = await clientPromise;
  const db = mongoClient.db();
  const cacheCollection = db.collection('rankings');

  // Check if calculation is already in progress
  const existingMetadata = (await cacheCollection.findOne({
    _id: 'metadata'
  } as never)) as CacheMetadata | null;

  if (existingMetadata?.isCalculating) {
    // Check if calculation has been running for too long (more than 2 minutes)
    const calculationTimeout = 2 * 60 * 1000; // 2 minutes
    const now = new Date();
    const calculationStarted = existingMetadata.calculationStarted || existingMetadata.createdAt;

    if (now.getTime() - calculationStarted.getTime() < calculationTimeout) {
      console.log('Calculation already in progress, skipping...');
      return;
    } else {
      console.log('Previous calculation appears stuck, proceeding with new calculation...');
    }
  }

  // Set calculation lock
  const calculationLock: CacheMetadata = {
    _id: 'metadata',
    createdAt: existingMetadata?.createdAt || new Date(),
    expiresAt: existingMetadata?.expiresAt || new Date(Date.now() - 1), // Expired during calculation
    totalCount: existingMetadata?.totalCount || 0,
    isCalculating: true,
    calculationStarted: new Date()
  };

  try {
    // Upsert the calculation lock
    await cacheCollection.replaceOne({ _id: 'metadata' } as never, calculationLock as never, {
      upsert: true
    });

    // Clear existing cache (except metadata)
    await cacheCollection.deleteMany({ _id: { $ne: 'metadata' } } as never);

    const universitiesCollection = db.collection('universities');
    const universities = (await universitiesCollection
      .find({})
      .toArray()) as unknown as University[];

    const shopsCollection = db.collection('shops');
    const shops = (await shopsCollection.find({}).toArray()) as unknown as Shop[];

    const rankings: UniversityRankingData[] = [];
    let processedCampuses = 0;
    let totalCampuses = 0;

    for (const university of universities) {
      if (university.campuses && university.campuses.length > 0) {
        totalCampuses += university.campuses.length;
      }
    }
    console.log(`Calculating rankings for ${totalCampuses} campuses...`);

    for (const university of universities) {
      if (!university.campuses || university.campuses.length === 0) continue;

      for (const campus of university.campuses) {
        processedCampuses++;

        if (processedCampuses % 100 === 0 || processedCampuses === totalCampuses) {
          console.log(
            `Progress: ${processedCampuses}/${totalCampuses} campuses (${((processedCampuses / totalCampuses) * 100).toFixed(1)}%)`
          );
        }

        const fullCampusName = campus.name
          ? `${university.name} (${campus.name})`
          : university.name;

        rankings.push({
          id: `${university.id}_${campus.id}`,
          universityName: university.name,
          campusName: campus.name,
          fullName: fullCampusName,
          type: university.type,
          majorCategory: university.majorCategory,
          natureOfRunning: university.natureOfRunning,
          affiliation: university.affiliation,
          is985: university.is985,
          is211: university.is211,
          isDoubleFirstClass: university.isDoubleFirstClass,
          province: campus.province,
          city: campus.city,
          district: campus.district,
          address: campus.address,
          location: campus.location,
          rankings: await Promise.all(
            RADIUS_OPTIONS.map((r) =>
              (async () =>
                calculateMetricsForRadius(
                  await getShopsWithinRadius(shops, campus.location, r),
                  r
                ))()
            )
          )
        });
      }
    }

    console.log(`Finished calculating rankings for ${rankings.length} campuses`);

    // Calculate rank orders for all sort criteria and radius combinations
    const sortCriteria: SortCriteria[] = [
      'shops',
      'machines',
      'density',
      'maimai_dx',
      'chunithm',
      'taiko_no_tatsujin',
      'sound_voltex',
      'wacca'
    ];

    const cachedRankings: CachedRanking[] = rankings.map((ranking) => {
      const rankOrder: { [key: string]: number } = {};

      // We'll calculate ranks after sorting
      return {
        ...ranking,
        rankOrder
      };
    });

    // Calculate ranks for each sort criteria and radius combination
    for (const sortBy of sortCriteria) {
      for (const radius of RADIUS_OPTIONS) {
        const sortKey = `${sortBy}_${radius}`;

        // Sort rankings for this criteria
        const sorted = [...cachedRankings].sort((a, b) => {
          const aMetrics = a.rankings.find((r) => r.radius === radius);
          const bMetrics = b.rankings.find((r) => r.radius === radius);

          if (!aMetrics || !bMetrics) return 0;

          switch (sortBy) {
            case 'shops':
              return bMetrics.shopCount - aMetrics.shopCount;
            case 'machines':
              return bMetrics.totalMachines - aMetrics.totalMachines;
            case 'density':
              return bMetrics.areaDensity - aMetrics.areaDensity;
            default: {
              const aEntry = aMetrics.gameSpecificMachines.find((e) => e.name == sortBy);
              const bEntry = bMetrics.gameSpecificMachines.find((e) => e.name == sortBy);
              if (!aEntry || !bEntry) return 0;
              return bEntry.quantity - aEntry.quantity;
            }
          }
        });

        // Assign ranks
        sorted.forEach((ranking, index) => {
          const cachedRanking = cachedRankings.find((r) => r.id === ranking.id);
          if (cachedRanking) {
            cachedRanking.rankOrder[sortKey] = index + 1;
          }
        });
      }
    }

    // Insert cached rankings into database
    if (cachedRankings.length > 0) {
      await cacheCollection.insertMany(cachedRankings as never[]);
    }

    // Update metadata document with final results and remove calculation lock
    const finalMetadata: CacheMetadata = {
      _id: 'metadata',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + CACHE_DURATION_MS),
      totalCount: cachedRankings.length,
      isCalculating: false,
      calculationStarted: undefined
    };

    await cacheCollection.replaceOne({ _id: 'metadata' } as never, finalMetadata as never, {
      upsert: true
    });

    console.log(`Cache updated with ${cachedRankings.length} campus rankings`);
  } catch (error) {
    console.error('Error during calculation:', error);

    // Remove calculation lock on error
    try {
      const errorMetadata: CacheMetadata = {
        _id: 'metadata',
        createdAt: existingMetadata?.createdAt || new Date(),
        expiresAt: existingMetadata?.expiresAt || new Date(Date.now() - 1),
        totalCount: existingMetadata?.totalCount || 0,
        isCalculating: false,
        calculationStarted: undefined
      };

      await cacheCollection.replaceOne({ _id: 'metadata' } as never, errorMetadata as never, {
        upsert: true
      });
    } catch (cleanupError) {
      console.error('Error cleaning up calculation lock:', cleanupError);
    }

    throw error;
  }
};

export const GET: RequestHandler = async ({ url }) => {
  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();
    const cacheCollection = db.collection('rankings');

    const sortBy = (url.searchParams.get('sortBy') as SortCriteria) || 'shops';
    const radiusFilter = parseInt(url.searchParams.get('radius') || '10') as RadiusFilter;

    const pageSize = parseInt(url.searchParams.get('pageSize') || PAGINATION.PAGE_SIZE.toString());
    const limit = parseInt(url.searchParams.get('limit') || pageSize.toString());
    const after = url.searchParams.get('after') || null;

    // Check cache metadata
    const metadata = (await cacheCollection.findOne({
      _id: 'metadata'
    } as never)) as CacheMetadata | null;
    const now = new Date();

    // If cache is expired, trigger background refresh
    if (metadata && metadata.expiresAt < now) {
      console.log('Triggering background refresh...');
      calculateAndCacheUniversityRankings().catch((err) =>
        console.error('Background cache refresh failed:', err)
      );
    }

    // Try to serve from cache if it exists and has data
    if (metadata) {
      if (metadata.totalCount > 0) {
        const sortKey = `${sortBy}_${radiusFilter}`;

        // Build query for cursor-based pagination
        const query: Record<string, unknown> = { _id: { $ne: 'metadata' } };

        if (after) {
          // Parse the after cursor (it contains the rank)
          const afterRank = parseInt(after);
          query[`rankOrder.${sortKey}`] = { $gt: afterRank };
        }

        // Get rankings sorted by the rank order we pre-calculated
        const rankings = (await cacheCollection
          .find(query)
          .sort({ [`rankOrder.${sortKey}`]: 1 })
          .limit(limit + 1) // Get one extra to check if there are more
          .toArray()) as unknown as CachedRanking[];

        // Check if there are more results
        const hasMore = rankings.length > limit;
        if (hasMore) {
          rankings.pop(); // Remove the extra item
        }

        // Get the next cursor
        const nextCursor =
          hasMore && rankings.length > 0
            ? rankings[rankings.length - 1].rankOrder[sortKey]?.toString()
            : null;

        // Convert to response format
        const responseData = rankings.map((ranking) => ({
          id: ranking.id,
          universityName: ranking.universityName,
          campusName: ranking.campusName,
          fullName: ranking.fullName,
          type: ranking.type,
          majorCategory: ranking.majorCategory,
          natureOfRunning: ranking.natureOfRunning,
          affiliation: ranking.affiliation,
          is985: ranking.is985,
          is211: ranking.is211,
          isDoubleFirstClass: ranking.isDoubleFirstClass,
          province: ranking.province,
          city: ranking.city,
          district: ranking.district,
          address: ranking.address,
          location: ranking.location,
          rankings: ranking.rankings
        }));

        return json({
          data: responseData,
          totalCount: metadata.totalCount,
          hasMore,
          nextCursor,
          cached: true,
          cacheTime: metadata.createdAt,
          stale: metadata.expiresAt < now
        });
      } else {
        return json({
          data: [],
          totalCount: 0,
          hasMore: false,
          nextCursor: null,
          cached: false,
          cacheTime: metadata.createdAt,
          stale: metadata.expiresAt < now,
          calculating: metadata.isCalculating
        });
      }
    } else {
      console.log('No cache metadata found, calculating fresh data...');
      await calculateAndCacheUniversityRankings();

      // Retry the request now that cache is populated
      return GET({ url } as Parameters<typeof GET>[0]);
    }
  } catch (err) {
    console.error('Error getting rankings:', err);
    throw error(500, 'Failed to get rankings');
  }
};

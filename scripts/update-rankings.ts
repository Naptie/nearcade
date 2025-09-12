import { MongoClient } from 'mongodb';
import type {
  University,
  Shop,
  UniversityRankingData,
  RankingMetrics,
  SortCriteria,
  Location
} from '../src/lib/types';
import { calculateDistance, getGameMachineCount, calculateAreaDensity } from '../src/lib/utils';
import { GAMES, RADIUS_OPTIONS } from '../src/lib/constants';

import dotenv from 'dotenv';

if (!('MONGODB_URI' in process.env)) {
  // Load environment variables for local development
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is not set.');
  process.exit(1);
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

const calculateAndCacheUniversityRankings = async (client: MongoClient): Promise<void> => {
  const db = client.db();
  const cacheCollection = db.collection('rankings');

  const existingMetadata = (await cacheCollection.findOne({
    _id: 'metadata'
  } as never)) as CacheMetadata | null;

  if (existingMetadata?.isCalculating) {
    const calculationTimeout = 15 * 60 * 1000; // 15 minutes
    const now = new Date();
    const calculationStarted = existingMetadata.calculationStarted || existingMetadata.createdAt;

    if (now.getTime() - calculationStarted.getTime() < calculationTimeout) {
      console.log('Calculation already in progress, skipping...');
      return;
    } else {
      console.log('Previous calculation appears stuck, proceeding with new calculation...');
    }
  }

  const calculationLock: CacheMetadata = {
    _id: 'metadata',
    createdAt: existingMetadata?.createdAt || new Date(),
    expiresAt: existingMetadata?.expiresAt || new Date(Date.now() - 1),
    totalCount: existingMetadata?.totalCount || 0,
    isCalculating: true,
    calculationStarted: new Date()
  };

  try {
    await cacheCollection.replaceOne({ _id: 'metadata' } as never, calculationLock as never, {
      upsert: true
    });

    await cacheCollection.deleteMany({ _id: { $ne: 'metadata' } } as never);

    const universities = (await db
      .collection('universities')
      .find({})
      .toArray()) as unknown as University[];
    const shops = (await db.collection('shops').find({}).toArray()) as unknown as Shop[];

    const rankings: UniversityRankingData[] = [];
    const totalCampuses = universities.reduce((sum, uni) => sum + (uni.campuses?.length || 0), 0);
    console.log(`Calculating rankings for ${totalCampuses} campuses...`);

    let processedCampuses = 0;
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
            RADIUS_OPTIONS.map(async (r) =>
              calculateMetricsForRadius(await getShopsWithinRadius(shops, campus.location, r), r)
            )
          )
        });
      }
    }

    console.log(`Finished calculating rankings for ${rankings.length} campuses.`);

    const sortCriteria: SortCriteria[] = [
      'shops',
      'machines',
      'density',
      ...GAMES.map((g) => g.key)
    ];

    const cachedRankings: CachedRanking[] = rankings.map((ranking) => ({
      ...ranking,
      rankOrder: {}
    }));

    for (const sortBy of sortCriteria) {
      for (const radius of RADIUS_OPTIONS) {
        const sortKey = `${sortBy}_${radius}`;
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
              return (bEntry?.quantity || 0) - (aEntry?.quantity || 0);
            }
          }
        });

        sorted.forEach((ranking, index) => {
          const cachedRanking = cachedRankings.find((r) => r.id === ranking.id);
          if (cachedRanking) {
            cachedRanking.rankOrder[sortKey] = index + 1;
          }
        });
      }
    }

    if (cachedRankings.length > 0) {
      await cacheCollection.insertMany(cachedRankings as never[]);
    }

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

    console.log(`Cache updated with ${cachedRankings.length} campus rankings.`);
  } catch (error) {
    console.error('Error during calculation:', error);
    const errorMetadata: CacheMetadata = {
      _id: 'metadata',
      createdAt: existingMetadata?.createdAt || new Date(),
      expiresAt: existingMetadata?.expiresAt || new Date(Date.now() - 1),
      totalCount: existingMetadata?.totalCount || 0,
      isCalculating: false,
      calculationStarted: undefined
    };
    await db
      .collection('rankings')
      .replaceOne({ _id: 'metadata' } as never, errorMetadata as never, {
        upsert: true
      });
    throw error;
  }
};

// Main execution block
(async () => {
  let client: MongoClient | undefined;
  try {
    console.log('Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('MongoDB connected. Starting ranking calculation...');
    await calculateAndCacheUniversityRankings(client);
    console.log('Ranking calculation finished successfully.');
  } catch (err) {
    console.error('An error occurred during the script execution:', err);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed.');
    }
  }
})();

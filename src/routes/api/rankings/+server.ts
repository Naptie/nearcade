import { json } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { error } from '@sveltejs/kit';
import { MongoClient } from 'mongodb';
import type { RequestHandler } from './$types';
import type {
  University,
  Shop,
  UniversityRankingData,
  UniversityRankingCache,
  RankingMetrics,
  SortCriteria,
  RadiusFilter
} from '$lib/types';
import { calculateDistance, getGameMachineCount, calculateAreaDensity } from '$lib/utils';
import { GAMES, PAGINATION, RADIUS_OPTIONS } from '$lib/constants';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

// Cache duration: 1 day (adjustable)
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

const getShopsWithinRadius = async (
  shops: Shop[],
  centerLat: number,
  centerLng: number,
  radiusKm: number
): Promise<Shop[]> => {
  return shops.filter((shop) => {
    const distance = calculateDistance(
      centerLat,
      centerLng,
      shop.location.latitude,
      shop.location.longitude
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

const calculateUniversityRankings = async (): Promise<UniversityRankingData[]> => {
  const mongoClient = await clientPromise;
  const db = mongoClient.db();

  const universitiesCollection = db.collection('universities');
  const universities = (await universitiesCollection.find({}).toArray()) as unknown as University[];

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

      // Log progress every 100 campuses or for the last campus
      if (processedCampuses % 100 === 0 || processedCampuses === totalCampuses) {
        console.log(
          `Progress: ${processedCampuses}/${totalCampuses} campuses (${((processedCampuses / totalCampuses) * 100).toFixed(1)}%)`
        );
      }

      const fullCampusName = campus.name ? `${university.name} (${campus.name})` : university.name;

      rankings.push({
        universityId: university._id?.toString() || '',
        universityName: university.name,
        campusName: campus.name,
        fullName: fullCampusName,
        province: university.province,
        city: university.city,
        affiliation: university.affiliation,
        schoolType: university.schoolType,
        is985: university.is985,
        is211: university.is211,
        isDoubleFirstClass: university.isDoubleFirstClass,
        latitude: campus.latitude,
        longitude: campus.longitude,
        rankings: await Promise.all(
          RADIUS_OPTIONS.map((r) =>
            (async () =>
              calculateMetricsForRadius(
                await getShopsWithinRadius(shops, campus.latitude, campus.longitude, r),
                r
              ))()
          )
        )
      });
    }
  }

  console.log(`Finished rankings calculation for ${rankings.length} campuses`);
  return rankings;
};

const sortAndPaginateRankings = (
  rankings: UniversityRankingData[],
  sortBy: SortCriteria,
  radiusFilter: RadiusFilter,
  page: number,
  pageSize: number
) => {
  const sortedRankings = rankings.sort((a, b) => {
    const aMetrics = a.rankings.find((r) => r.radius === radiusFilter);
    const bMetrics = b.rankings.find((r) => r.radius === radiusFilter);

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

  const startIndex = page * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedData = sortedRankings.slice(startIndex, endIndex);

  return {
    data: paginatedData,
    totalCount: sortedRankings.length,
    hasMore: endIndex < sortedRankings.length,
    currentPage: page
  };
};

export const GET: RequestHandler = async ({ url }) => {
  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();
    const cacheCollection = db.collection('rankings');

    // Ensure the collection is capped (max 5 documents, 5MB)
    try {
      await db.createCollection('rankings', {
        capped: true,
        size: 5 * 1024 * 1024,
        max: 5
      });
    } catch (err) {
      if ((err as { code: number }).code !== 48) {
        console.log('Collection already exists:', err);
      }
    }

    const sortBy = (url.searchParams.get('sortBy') as SortCriteria) || 'shops';
    const radiusFilter = parseInt(url.searchParams.get('radius') || '10') as RadiusFilter;
    const page = parseInt(url.searchParams.get('page') || '0');
    const pageSize = parseInt(url.searchParams.get('pageSize') || PAGINATION.PAGE_SIZE.toString());

    const now = new Date();
    const validCache = (await cacheCollection.findOne({
      expiresAt: { $gt: now }
    })) as unknown as UniversityRankingCache | null;
    if (validCache) {
      const result = sortAndPaginateRankings(validCache.data, sortBy, radiusFilter, page, pageSize);
      return json({
        ...result,
        cached: true,
        cacheTime: validCache.createdAt
      });
    }

    const staleCache = (await cacheCollection.findOne(
      {},
      { sort: { createdAt: -1 } }
    )) as unknown as UniversityRankingCache | null;

    const computeNewData = async () => {
      try {
        const newData = await calculateUniversityRankings();
        const newCacheEntry = {
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + CACHE_DURATION_MS),
          data: newData
        };

        await cacheCollection.deleteMany({});
        await cacheCollection.insertOne(newCacheEntry);
      } catch (computeError) {
        console.error('Error computing rankings:', computeError);
      }
    };

    computeNewData();
    if (staleCache) {
      const result = sortAndPaginateRankings(staleCache.data, sortBy, radiusFilter, page, pageSize);
      return json({
        ...result,
        cached: true,
        cacheTime: staleCache.createdAt,
        stale: true
      });
    } else {
      const newData = await calculateUniversityRankings();
      const newCacheEntry = {
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + CACHE_DURATION_MS),
        data: newData
      };

      await cacheCollection.insertOne(newCacheEntry);

      const result = sortAndPaginateRankings(newData, sortBy, radiusFilter, page, pageSize);
      return json({
        ...result,
        cached: false,
        cacheTime: newCacheEntry.createdAt
      });
    }
  } catch (err) {
    console.error('Error getting rankings:', err);
    throw error(500, 'Failed to get rankings');
  }
};

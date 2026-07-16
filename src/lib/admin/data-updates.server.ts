import { env } from '$env/dynamic/public';
import type { MongoClient } from 'mongodb';
import mongo from '$lib/db/index.server';
import { GAME_TITLES, RANKING_RADIUS_OPTIONS, REGION_LEVELS } from '$lib/constants';
import type {
  Club,
  Location,
  RankingMetrics,
  RegionLevel,
  RegionRankingData,
  SortCriteria,
  University,
  UniversityMember,
  UniversityRankingData
} from '$lib/types';
import { calculateAreaDensity, calculateDistance } from '$lib/utils';
import { getOrigin } from '$lib/utils/index.server';

export const DATA_UPDATE_TASK_IDS = ['university_stats', 'rankings', 'region_rankings'] as const;

export type DataUpdateTaskId = (typeof DATA_UPDATE_TASK_IDS)[number];
export type DataUpdateTaskState = 'idle' | 'running' | 'succeeded' | 'failed';

export interface DataUpdateTaskProgress {
  processed: number;
  total: number | null;
}

export interface DataUpdateTaskSummary {
  [key: string]: number | string | boolean | null;
}

export interface DataUpdateTask {
  id: DataUpdateTaskId;
  status: DataUpdateTaskState;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastSuccessfulAt: Date | null;
  updatedAt: Date;
  durationMs: number | null;
  lastError: string | null;
  progress: DataUpdateTaskProgress | null;
  summary: DataUpdateTaskSummary | null;
  triggerSource: 'site_admin' | 'ssc' | null;
  triggerUserId: string | null;
  triggerUserName: string | null;
}

interface DataUpdateTaskRecord {
  _id: DataUpdateTaskId;
  status: DataUpdateTaskState;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  lastSuccessfulAt?: Date | null;
  updatedAt: Date;
  durationMs?: number | null;
  lastError?: string | null;
  progress?: DataUpdateTaskProgress | null;
  summary?: DataUpdateTaskSummary | null;
  triggerSource?: 'site_admin' | 'ssc' | null;
  triggerUserId?: string | null;
  triggerUserName?: string | null;
}

interface RankingsCacheMetadata {
  _id: string;
  createdAt: Date;
  expiresAt: Date;
  totalCount: number;
  isCalculating?: boolean;
  calculationStarted?: Date;
}

interface RegionRankingsCacheMetadata {
  _id: string;
  createdAt: Date;
  expiresAt: Date;
  totalCount: number;
  isCalculating?: boolean;
  calculationStarted?: Date;
}

interface CachedRanking extends UniversityRankingData {
  rankOrder: Record<string, number>;
}

interface CachedRegionRanking extends RegionRankingData {
  _id: string;
  rankOrder: Record<string, number>;
}

interface UniversityStats {
  studentsCount: number;
  frequentingArcades: number[];
  clubsCount: number;
}

interface RankingsShop {
  location: Location;
  address?: { general?: string[] };
  games: Array<{
    titleId: number;
    quantity: number;
  }>;
}

interface RankingsCampus {
  id: string;
  name: string | null;
  province: string;
  city: string;
  district: string | null;
  address: string;
  location: Location;
}

interface RankingsUniversity {
  id: string;
  name: string;
  type: string;
  majorCategory: string | null;
  natureOfRunning: string | null;
  affiliation: string;
  is985: boolean | null;
  is211: boolean | null;
  isDoubleFirstClass: boolean | null;
  campuses?: RankingsCampus[];
}

export interface DataUpdateTriggerContext {
  source: 'site_admin' | 'ssc';
  userId?: string | null;
  userName?: string | null;
}

export interface TriggerDataUpdateResult {
  started: boolean;
  alreadyRunning: boolean;
  task: DataUpdateTask;
}

export const getAdminDataUpdateTriggerUrl = (request?: Request) => {
  const origin = request ? getOrigin(request) : env.PUBLIC_ORIGIN;
  return origin ? `${origin}/api/admin/data-updates` : '/api/admin/data-updates';
};

type ProgressReporter = (
  progress: DataUpdateTaskProgress,
  summary?: DataUpdateTaskSummary | null
) => Promise<void>;

const DATA_UPDATE_COLLECTION = 'admin_data_updates';
const RANKINGS_CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const TASK_TIMEOUT_MS: Record<DataUpdateTaskId, number> = {
  university_stats: 30 * 60 * 1000,
  rankings: 60 * 60 * 1000,
  region_rankings: 60 * 60 * 1000
};

const getTaskCollection = (client: MongoClient) =>
  client.db().collection<DataUpdateTaskRecord>(DATA_UPDATE_COLLECTION);

const normalizeTaskRecord = (
  taskId: DataUpdateTaskId,
  record?: Partial<DataUpdateTaskRecord> | null
): DataUpdateTaskRecord => ({
  _id: taskId,
  status: record?.status ?? 'idle',
  startedAt: record?.startedAt ?? null,
  finishedAt: record?.finishedAt ?? null,
  lastSuccessfulAt: record?.lastSuccessfulAt ?? null,
  updatedAt: record?.updatedAt ?? new Date(0),
  durationMs: record?.durationMs ?? null,
  lastError: record?.lastError ?? null,
  progress: record?.progress ?? null,
  summary: record?.summary ?? null,
  triggerSource: record?.triggerSource ?? null,
  triggerUserId: record?.triggerUserId ?? null,
  triggerUserName: record?.triggerUserName ?? null
});

const toPublicTask = (record: DataUpdateTaskRecord): DataUpdateTask => ({
  id: record._id,
  status: record.status,
  startedAt: record.startedAt ?? null,
  finishedAt: record.finishedAt ?? null,
  lastSuccessfulAt: record.lastSuccessfulAt ?? null,
  updatedAt: record.updatedAt,
  durationMs: record.durationMs ?? null,
  lastError: record.lastError ?? null,
  progress: record.progress ?? null,
  summary: record.summary ?? null,
  triggerSource: record.triggerSource ?? null,
  triggerUserId: record.triggerUserId ?? null,
  triggerUserName: record.triggerUserName ?? null
});

const isDuplicateKeyError = (error: unknown): error is { code: number } =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

const getDerivedRankingsTaskRecord = async (
  client: MongoClient
): Promise<Partial<DataUpdateTaskRecord>> => {
  const metadata = (await client
    .db()
    .collection('rankings')
    .findOne({
      _id: 'metadata'
    } as never)) as RankingsCacheMetadata | null;

  if (!metadata) {
    return {};
  }

  return {
    status: metadata.isCalculating ? 'running' : 'succeeded',
    startedAt: metadata.calculationStarted ?? null,
    finishedAt: metadata.isCalculating ? null : (metadata.createdAt ?? null),
    lastSuccessfulAt: metadata.createdAt ?? null,
    updatedAt: metadata.calculationStarted ?? metadata.createdAt ?? new Date(0),
    summary: {
      totalCount: metadata.totalCount ?? 0,
      cached: true
    }
  };
};

const getDerivedRegionRankingsTaskRecord = async (
  client: MongoClient
): Promise<Partial<DataUpdateTaskRecord>> => {
  const metadata = (await client
    .db()
    .collection('region_rankings')
    .findOne({
      _id: 'metadata'
    } as never)) as RegionRankingsCacheMetadata | null;

  if (!metadata) {
    return {};
  }

  return {
    status: metadata.isCalculating ? 'running' : 'succeeded',
    startedAt: metadata.calculationStarted ?? null,
    finishedAt: metadata.isCalculating ? null : (metadata.createdAt ?? null),
    lastSuccessfulAt: metadata.createdAt ?? null,
    updatedAt: metadata.calculationStarted ?? metadata.createdAt ?? new Date(0),
    summary: {
      totalCount: metadata.totalCount ?? 0,
      cached: true
    }
  };
};

const getDerivedUniversityStatsTaskRecord = async (
  client: MongoClient
): Promise<Partial<DataUpdateTaskRecord>> => {
  const [summary] = (await client
    .db()
    .collection<University>('universities')
    .aggregate([
      {
        $group: {
          _id: null,
          totalUniversities: { $sum: 1 },
          totalStudents: { $sum: { $ifNull: ['$studentsCount', 0] } },
          totalClubs: { $sum: { $ifNull: ['$clubsCount', 0] } },
          lastUpdatedAt: { $max: '$updatedAt' }
        }
      }
    ])
    .toArray()) as Array<{
    totalUniversities: number;
    totalStudents: number;
    totalClubs: number;
  }>;

  if (!summary) {
    return {};
  }

  return {
    status: 'idle',
    updatedAt: new Date(0),
    summary: {
      totalUniversities: summary.totalUniversities,
      totalStudents: summary.totalStudents,
      totalClubs: summary.totalClubs
    }
  };
};

const getDerivedTaskRecord = async (
  taskId: DataUpdateTaskId,
  client: MongoClient
): Promise<DataUpdateTaskRecord> => {
  const derived =
    taskId === 'rankings'
      ? await getDerivedRankingsTaskRecord(client)
      : taskId === 'region_rankings'
        ? await getDerivedRegionRankingsTaskRecord(client)
        : await getDerivedUniversityStatsTaskRecord(client);

  return normalizeTaskRecord(taskId, derived);
};

const hydrateTaskRecord = async (
  taskId: DataUpdateTaskId,
  client: MongoClient,
  record?: DataUpdateTaskRecord | null
): Promise<DataUpdateTaskRecord> => {
  const derived = await getDerivedTaskRecord(taskId, client);

  if (!record) {
    return derived;
  }

  return normalizeTaskRecord(taskId, {
    ...derived,
    ...record,
    finishedAt: record.finishedAt ?? derived.finishedAt,
    lastSuccessfulAt: record.lastSuccessfulAt ?? derived.lastSuccessfulAt,
    summary: record.summary ?? derived.summary
  });
};

export const getDataUpdateTask = async (
  taskId: DataUpdateTaskId,
  client: MongoClient = mongo
): Promise<DataUpdateTask> => {
  const record = await getTaskCollection(client).findOne({ _id: taskId });
  return toPublicTask(await hydrateTaskRecord(taskId, client, record));
};

export const listDataUpdateTasks = async (
  client: MongoClient = mongo
): Promise<DataUpdateTask[]> => {
  const records = await getTaskCollection(client)
    .find({ _id: { $in: [...DATA_UPDATE_TASK_IDS] } })
    .toArray();

  return await Promise.all(
    DATA_UPDATE_TASK_IDS.map(async (taskId) => {
      const record = records.find((entry) => entry._id === taskId);
      return toPublicTask(await hydrateTaskRecord(taskId, client, record));
    })
  );
};

const updateTaskProgress = async (
  taskId: DataUpdateTaskId,
  progress: DataUpdateTaskProgress,
  summary?: DataUpdateTaskSummary | null,
  client: MongoClient = mongo
) => {
  await getTaskCollection(client).updateOne(
    { _id: taskId },
    {
      $set: {
        updatedAt: new Date(),
        progress,
        ...(summary !== undefined ? { summary } : {})
      }
    }
  );
};

const finishTaskRun = async (
  taskId: DataUpdateTaskId,
  startedAt: Date,
  status: Extract<DataUpdateTaskState, 'succeeded' | 'failed'>,
  options: {
    error?: unknown;
    progress?: DataUpdateTaskProgress | null;
    summary?: DataUpdateTaskSummary | null;
  },
  client: MongoClient = mongo
) => {
  const finishedAt = new Date();
  const message =
    options.error instanceof Error
      ? options.error.message
      : typeof options.error === 'string'
        ? options.error
        : options.error
          ? JSON.stringify(options.error)
          : null;

  await getTaskCollection(client).updateOne(
    { _id: taskId },
    {
      $set: {
        status,
        finishedAt,
        updatedAt: finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        progress: options.progress ?? null,
        summary: options.summary ?? null,
        lastError: status === 'failed' ? message : null,
        ...(status === 'succeeded' ? { lastSuccessfulAt: finishedAt } : {})
      }
    }
  );
};

const claimTaskRun = async (
  taskId: DataUpdateTaskId,
  trigger: DataUpdateTriggerContext,
  client: MongoClient = mongo
): Promise<TriggerDataUpdateResult> => {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - TASK_TIMEOUT_MS[taskId]);

  const updated = await getTaskCollection(client).findOneAndUpdate(
    {
      _id: taskId,
      $or: [
        { status: { $ne: 'running' } },
        { updatedAt: { $lt: staleBefore } },
        { startedAt: { $lt: staleBefore } }
      ]
    },
    {
      $set: {
        status: 'running',
        startedAt: now,
        finishedAt: null,
        updatedAt: now,
        durationMs: null,
        lastError: null,
        progress: { processed: 0, total: null },
        summary: null,
        triggerSource: trigger.source,
        triggerUserId: trigger.userId ?? null,
        triggerUserName: trigger.userName ?? null
      }
    },
    { returnDocument: 'after' }
  );

  if (updated) {
    return {
      started: true,
      alreadyRunning: false,
      task: toPublicTask(normalizeTaskRecord(taskId, updated))
    };
  }

  try {
    const inserted = normalizeTaskRecord(taskId, {
      status: 'running',
      startedAt: now,
      finishedAt: null,
      lastSuccessfulAt: null,
      updatedAt: now,
      durationMs: null,
      lastError: null,
      progress: { processed: 0, total: null },
      summary: null,
      triggerSource: trigger.source,
      triggerUserId: trigger.userId ?? null,
      triggerUserName: trigger.userName ?? null
    });

    await getTaskCollection(client).insertOne(inserted);

    return {
      started: true,
      alreadyRunning: false,
      task: toPublicTask(inserted)
    };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return {
        started: false,
        alreadyRunning: true,
        task: await getDataUpdateTask(taskId, client)
      };
    }

    throw error;
  }
};

const getShopsWithinRadius = (
  shops: RankingsShop[],
  center: Location,
  radiusKm: number
): RankingsShop[] => {
  return shops.filter((shop) => {
    const distance = calculateDistance(
      center.coordinates[1],
      center.coordinates[0],
      shop.location.coordinates[1],
      shop.location.coordinates[0]
    );

    return distance <= radiusKm;
  });
};

const countGameMachines = (shops: RankingsShop[], titleId: number): number => {
  return shops.reduce((total, shop) => {
    const game = shop.games?.find((entry) => entry.titleId === titleId);
    return total + (game?.quantity || 0);
  }, 0);
};

const calculateMetricsForRadius = (shops: RankingsShop[], radiusKm: number): RankingMetrics => {
  const totalMachines = shops.reduce(
    (total, shop) =>
      total +
      shop.games.reduce(
        (gameTotal: number, game: { quantity: number }) => gameTotal + game.quantity,
        0
      ),
    0
  );

  return {
    radius: radiusKm,
    shopCount: shops.length,
    totalMachines,
    areaDensity: calculateAreaDensity(totalMachines, radiusKm),
    gameSpecificMachines: GAME_TITLES.map((game) => ({
      name: game.key,
      quantity: countGameMachines(shops, game.id)
    }))
  };
};

const calculateUniversityStats = async (
  universityId: string,
  client: MongoClient
): Promise<UniversityStats> => {
  const db = client.db();
  const membersCollection = db.collection<UniversityMember>('university_members');
  const clubsCollection = db.collection<Club>('clubs');
  const usersCollection = db.collection('users');

  const studentsCount = await membersCollection.countDocuments({ universityId });
  const clubsCount = await clubsCollection.countDocuments({ universityId });

  const memberUserIds = await membersCollection
    .find({ universityId })
    .project({ userId: 1 })
    .toArray();
  const userIds = memberUserIds.map((member) => member.userId);

  if (userIds.length === 0) {
    return {
      studentsCount,
      frequentingArcades: [],
      clubsCount
    };
  }

  const usersWithArcades = await usersCollection
    .find({
      id: { $in: userIds },
      frequentingArcades: { $exists: true, $ne: null, $not: { $size: 0 } }
    })
    .project({ frequentingArcades: 1 })
    .toArray();

  const arcadeFrequency = new Map<number, number>();

  for (const user of usersWithArcades) {
    if (!Array.isArray(user.frequentingArcades)) {
      continue;
    }

    for (const arcadeId of user.frequentingArcades as number[]) {
      arcadeFrequency.set(arcadeId, (arcadeFrequency.get(arcadeId) || 0) + 1);
    }
  }

  const frequentingArcades = Array.from(arcadeFrequency.entries())
    .filter(([, count]) => count >= 2)
    .map(([arcadeId]) => arcadeId)
    .sort((left, right) => left - right);

  return {
    studentsCount,
    frequentingArcades,
    clubsCount
  };
};

const runUniversityStatsTask = async (
  client: MongoClient,
  reportProgress: ProgressReporter
): Promise<{
  progress: DataUpdateTaskProgress;
  summary: DataUpdateTaskSummary;
}> => {
  const db = client.db();
  const universitiesCollection = db.collection('universities');
  const universities = (await universitiesCollection.find({}).toArray()) as unknown as University[];

  await reportProgress({ processed: 0, total: universities.length });

  if (universities.length === 0) {
    return {
      progress: { processed: 0, total: 0 },
      summary: {
        processedCount: 0,
        updatedCount: 0,
        errorCount: 0
      }
    };
  }

  let processedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const university of universities) {
    try {
      processedCount += 1;
      const stats = await calculateUniversityStats(university.id, client);

      const updateResult = await universitiesCollection.updateOne(
        { id: university.id },
        {
          $set: {
            studentsCount: stats.studentsCount,
            frequentingArcades: stats.frequentingArcades,
            clubsCount: stats.clubsCount,
            updatedAt: new Date()
          }
        }
      );

      if (updateResult.modifiedCount > 0) {
        updatedCount += 1;
      }
    } catch (error) {
      errorCount += 1;
      console.error(`Failed to update university stats for ${university.id}:`, error);
    }

    if (processedCount % 10 === 0 || processedCount === universities.length) {
      await reportProgress(
        { processed: processedCount, total: universities.length },
        {
          processedCount,
          updatedCount,
          errorCount
        }
      );
    }
  }

  return {
    progress: { processed: processedCount, total: universities.length },
    summary: {
      processedCount,
      updatedCount,
      errorCount
    }
  };
};

const runRankingsTask = async (
  client: MongoClient,
  reportProgress: ProgressReporter
): Promise<{
  progress: DataUpdateTaskProgress;
  summary: DataUpdateTaskSummary;
}> => {
  const db = client.db();
  const cacheCollection = db.collection('rankings');
  const existingMetadata = (await cacheCollection.findOne({
    _id: 'metadata'
  } as never)) as RankingsCacheMetadata | null;

  await cacheCollection.replaceOne(
    { _id: 'metadata' } as never,
    {
      _id: 'metadata',
      createdAt: existingMetadata?.createdAt || new Date(),
      expiresAt: existingMetadata?.expiresAt || new Date(Date.now() - 1),
      totalCount: existingMetadata?.totalCount || 0,
      isCalculating: true,
      calculationStarted: new Date()
    } as never,
    { upsert: true }
  );

  try {
    await cacheCollection.deleteMany({ _id: { $ne: 'metadata' } } as never);

    const universities = await db.collection<RankingsUniversity>('universities').find({}).toArray();
    const shops = await db.collection<RankingsShop>('shops').find({}).toArray();

    const totalCampuses = universities.reduce(
      (sum, university) => sum + (university.campuses?.length || 0),
      0
    );
    const rankings: UniversityRankingData[] = [];

    await reportProgress({ processed: 0, total: totalCampuses });

    let processedCampuses = 0;
    for (const university of universities) {
      if (!university.campuses || university.campuses.length === 0) {
        continue;
      }

      for (const campus of university.campuses) {
        processedCampuses += 1;

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
          rankings: RANKING_RADIUS_OPTIONS.map((radius) =>
            calculateMetricsForRadius(getShopsWithinRadius(shops, campus.location, radius), radius)
          )
        });

        if (processedCampuses % 100 === 0 || processedCampuses === totalCampuses) {
          await reportProgress(
            { processed: processedCampuses, total: totalCampuses },
            {
              processedCount: processedCampuses,
              campusCount: totalCampuses
            }
          );
        }
      }
    }

    const sortCriteria: SortCriteria[] = [
      'shops',
      'machines',
      'density',
      ...GAME_TITLES.map((game) => game.key)
    ];

    const cachedRankings: CachedRanking[] = rankings.map((ranking) => ({
      ...ranking,
      rankOrder: {}
    }));

    for (const sortBy of sortCriteria) {
      for (const radius of RANKING_RADIUS_OPTIONS) {
        const sortKey = `${sortBy}_${radius}`;
        const sorted = [...cachedRankings].sort((left, right) => {
          const leftMetrics = left.rankings.find((entry) => entry.radius === radius);
          const rightMetrics = right.rankings.find((entry) => entry.radius === radius);

          if (!leftMetrics || !rightMetrics) {
            return 0;
          }

          switch (sortBy) {
            case 'shops':
              return rightMetrics.shopCount - leftMetrics.shopCount;
            case 'machines':
              return rightMetrics.totalMachines - leftMetrics.totalMachines;
            case 'density':
              return rightMetrics.areaDensity - leftMetrics.areaDensity;
            default: {
              const leftEntry = leftMetrics.gameSpecificMachines.find(
                (entry) => entry.name === sortBy
              );
              const rightEntry = rightMetrics.gameSpecificMachines.find(
                (entry) => entry.name === sortBy
              );
              return (rightEntry?.quantity || 0) - (leftEntry?.quantity || 0);
            }
          }
        });

        sorted.forEach((ranking, index) => {
          ranking.rankOrder[sortKey] = index + 1;
        });
      }
    }

    if (cachedRankings.length > 0) {
      await cacheCollection.insertMany(cachedRankings as never[]);
    }

    await cacheCollection.replaceOne(
      { _id: 'metadata' } as never,
      {
        _id: 'metadata',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + RANKINGS_CACHE_DURATION_MS),
        totalCount: cachedRankings.length,
        isCalculating: false,
        calculationStarted: undefined
      } as never,
      { upsert: true }
    );

    return {
      progress: { processed: processedCampuses, total: totalCampuses },
      summary: {
        processedCount: processedCampuses,
        campusCount: totalCampuses,
        totalCount: cachedRankings.length
      }
    };
  } catch (error) {
    await cacheCollection.replaceOne(
      { _id: 'metadata' } as never,
      {
        _id: 'metadata',
        createdAt: existingMetadata?.createdAt || new Date(),
        expiresAt: existingMetadata?.expiresAt || new Date(Date.now() - 1),
        totalCount: existingMetadata?.totalCount || 0,
        isCalculating: false,
        calculationStarted: undefined
      } as never,
      { upsert: true }
    );

    throw error;
  }
};

interface RegionNode {
  id: string;
  level: RegionLevel;
  name: string;
  country: string | null;
  province: string | null;
  city: string | null;
  county: string | null;
  shopCount: number;
  totalMachines: number;
  gameQuantities: Map<number, number>;
  locations: Array<[number, number]>;
}

const buildRegionNode = (
  level: RegionLevel,
  name: string,
  country: string | null,
  province: string | null,
  city: string | null,
  county: string | null,
  shopCount: number,
  totalMachines: number,
  gameQuantities: Map<number, number>,
  locations: Array<[number, number]>
): RegionNode => {
  const levelIndex = REGION_LEVELS.findIndex((l) => l.key === level);
  const idParts = [country, province, city, county].slice(0, levelIndex + 1).filter(Boolean);
  return {
    id: `${level}:${idParts.join(':')}`,
    level,
    name,
    country,
    province,
    city,
    county,
    shopCount,
    totalMachines,
    gameQuantities,
    locations
  };
};

const nodeToRegionData = (node: RegionNode): RegionRankingData => {
  const loc: Location =
    node.locations.length > 0
      ? {
          type: 'Point',
          coordinates: [
            node.locations.reduce((s, c) => s + c[0], 0) / node.locations.length,
            node.locations.reduce((s, c) => s + c[1], 0) / node.locations.length
          ] as [number, number]
        }
      : { type: 'Point', coordinates: [0, 0] as [number, number] };

  return {
    id: node.id,
    level: node.level,
    name: node.name,
    country: node.country,
    province: node.province,
    city: node.city,
    county: node.county,
    location: loc,
    rankings: RANKING_RADIUS_OPTIONS.map((radius) => ({
      radius,
      shopCount: node.shopCount,
      totalMachines: node.totalMachines,
      areaDensity: calculateAreaDensity(node.totalMachines, radius),
      gameSpecificMachines: GAME_TITLES.map((game) => ({
        name: game.key,
        quantity: node.gameQuantities.get(game.id) || 0
      }))
    }))
  };
};

const buildRegionRankings = (shops: RankingsShop[]): RegionRankingData[] => {
  // Phase 1: aggregate shops into county-level nodes
  const counties = new Map<string, RegionNode>();

  for (const shop of shops) {
    if (!shop.address?.general) continue;
    const addr = shop.address.general;
    if (addr.length < 4 || !addr[3]) continue;

    const id = `county:${addr[0]}:${addr[1]}:${addr[2]}:${addr[3]}`;
    const machines = shop.games.reduce((s, g) => s + g.quantity, 0);
    const loc: [number, number] = shop.location?.coordinates ?? [0, 0];

    const existing = counties.get(id);
    if (existing) {
      existing.shopCount += 1;
      existing.totalMachines += machines;
      existing.locations.push(loc);
      for (const g of shop.games) {
        existing.gameQuantities.set(
          g.titleId,
          (existing.gameQuantities.get(g.titleId) || 0) + g.quantity
        );
      }
    } else {
      const gameQuantities = new Map<number, number>();
      for (const g of shop.games) {
        gameQuantities.set(g.titleId, g.quantity);
      }
      counties.set(
        id,
        buildRegionNode(
          'county',
          addr[3],
          addr[0],
          addr[1],
          addr[2],
          addr[3],
          1,
          machines,
          gameQuantities,
          [loc]
        )
      );
    }
  }

  // Phase 2: roll counties up into cities
  const cities = new Map<string, RegionNode>();
  for (const county of counties.values()) {
    const id = `city:${county.country}:${county.province}:${county.city}`;
    const existing = cities.get(id);
    if (existing) {
      existing.shopCount += county.shopCount;
      existing.totalMachines += county.totalMachines;
      existing.locations.push(...county.locations);
      for (const [tid, qty] of county.gameQuantities) {
        existing.gameQuantities.set(tid, (existing.gameQuantities.get(tid) || 0) + qty);
      }
    } else {
      const gameQuantities = new Map(county.gameQuantities);
      cities.set(
        id,
        buildRegionNode(
          'city',
          county.city!,
          county.country,
          county.province,
          county.city,
          null,
          county.shopCount,
          county.totalMachines,
          gameQuantities,
          [...county.locations]
        )
      );
    }
  }

  // Phase 3: roll cities up into provinces
  const provinces = new Map<string, RegionNode>();
  for (const city of cities.values()) {
    const id = `province:${city.country}:${city.province}`;
    const existing = provinces.get(id);
    if (existing) {
      existing.shopCount += city.shopCount;
      existing.totalMachines += city.totalMachines;
      existing.locations.push(...city.locations);
      for (const [tid, qty] of city.gameQuantities) {
        existing.gameQuantities.set(tid, (existing.gameQuantities.get(tid) || 0) + qty);
      }
    } else {
      const gameQuantities = new Map(city.gameQuantities);
      provinces.set(
        id,
        buildRegionNode(
          'province',
          city.province!,
          city.country,
          city.province,
          null,
          null,
          city.shopCount,
          city.totalMachines,
          gameQuantities,
          [...city.locations]
        )
      );
    }
  }

  // Phase 4: roll provinces up into countries
  const countries = new Map<string, RegionNode>();
  for (const province of provinces.values()) {
    const id = `country:${province.country}`;
    const existing = countries.get(id);
    if (existing) {
      existing.shopCount += province.shopCount;
      existing.totalMachines += province.totalMachines;
      existing.locations.push(...province.locations);
      for (const [tid, qty] of province.gameQuantities) {
        existing.gameQuantities.set(tid, (existing.gameQuantities.get(tid) || 0) + qty);
      }
    } else {
      const gameQuantities = new Map(province.gameQuantities);
      countries.set(
        id,
        buildRegionNode(
          'country',
          province.country!,
          province.country,
          null,
          null,
          null,
          province.shopCount,
          province.totalMachines,
          gameQuantities,
          [...province.locations]
        )
      );
    }
  }

  // Collect all levels
  const allNodes = new Map<string, RegionNode>();
  for (const n of counties.values()) allNodes.set(n.id, n);
  for (const n of cities.values()) allNodes.set(n.id, n);
  for (const n of provinces.values()) allNodes.set(n.id, n);
  for (const n of countries.values()) allNodes.set(n.id, n);

  return Array.from(allNodes.values()).map(nodeToRegionData);
};

const runRegionRankingsTask = async (
  client: MongoClient,
  reportProgress: ProgressReporter
): Promise<{
  progress: DataUpdateTaskProgress;
  summary: DataUpdateTaskSummary;
}> => {
  const db = client.db();
  const cacheCollection = db.collection('region_rankings');
  const existingMetadata = (await cacheCollection.findOne({
    _id: 'metadata'
  } as never)) as RegionRankingsCacheMetadata | null;

  await cacheCollection.replaceOne(
    { _id: 'metadata' } as never,
    {
      _id: 'metadata',
      createdAt: existingMetadata?.createdAt || new Date(),
      expiresAt: existingMetadata?.expiresAt || new Date(Date.now() - 1),
      totalCount: existingMetadata?.totalCount || 0,
      isCalculating: true,
      calculationStarted: new Date()
    } as never,
    { upsert: true }
  );

  try {
    await cacheCollection.deleteMany({ _id: { $ne: 'metadata' } } as never);

    const shops = await db.collection<RankingsShop>('shops').find({}).toArray();

    const rankings = buildRegionRankings(shops);

    const sortCriteria: SortCriteria[] = [
      'shops',
      'machines',
      'density',
      ...GAME_TITLES.map((game) => game.key)
    ];

    const cachedRankings: CachedRegionRanking[] = rankings.map((ranking) => ({
      _id: ranking.id,
      ...ranking,
      rankOrder: {}
    }));

    for (const sortBy of sortCriteria) {
      for (const radius of RANKING_RADIUS_OPTIONS) {
        const sortKey = `${sortBy}_${radius}`;
        const sorted = [...cachedRankings].sort((left, right) => {
          const leftMetrics = left.rankings.find((entry) => entry.radius === radius);
          const rightMetrics = right.rankings.find((entry) => entry.radius === radius);

          if (!leftMetrics || !rightMetrics) {
            return 0;
          }

          switch (sortBy) {
            case 'shops':
              return rightMetrics.shopCount - leftMetrics.shopCount;
            case 'machines':
              return rightMetrics.totalMachines - leftMetrics.totalMachines;
            case 'density':
              return rightMetrics.areaDensity - leftMetrics.areaDensity;
            default: {
              const leftEntry = leftMetrics.gameSpecificMachines.find(
                (entry) => entry.name === sortBy
              );
              const rightEntry = rightMetrics.gameSpecificMachines.find(
                (entry) => entry.name === sortBy
              );
              return (rightEntry?.quantity || 0) - (leftEntry?.quantity || 0);
            }
          }
        });

        sorted.forEach((ranking, index) => {
          ranking.rankOrder[sortKey] = index + 1;
        });
      }
    }

    await reportProgress(
      { processed: rankings.length, total: rankings.length },
      { totalCount: cachedRankings.length }
    );

    if (cachedRankings.length > 0) {
      await cacheCollection.insertMany(cachedRankings as never[]);
    }

    await cacheCollection.replaceOne(
      { _id: 'metadata' } as never,
      {
        _id: 'metadata',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + RANKINGS_CACHE_DURATION_MS),
        totalCount: cachedRankings.length,
        isCalculating: false,
        calculationStarted: undefined
      } as never,
      { upsert: true }
    );

    return {
      progress: { processed: rankings.length, total: rankings.length },
      summary: {
        totalCount: cachedRankings.length
      }
    };
  } catch (error) {
    await cacheCollection.replaceOne(
      { _id: 'metadata' } as never,
      {
        _id: 'metadata',
        createdAt: existingMetadata?.createdAt || new Date(),
        expiresAt: existingMetadata?.expiresAt || new Date(Date.now() - 1),
        totalCount: existingMetadata?.totalCount || 0,
        isCalculating: false,
        calculationStarted: undefined
      } as never,
      { upsert: true }
    );

    throw error;
  }
};

const runTaskInBackground = (
  taskId: DataUpdateTaskId,
  startedAt: Date,
  client: MongoClient = mongo
) => {
  queueMicrotask(() => {
    void (async () => {
      try {
        const result =
          taskId === 'rankings'
            ? await runRankingsTask(client, (progress, summary) =>
                updateTaskProgress(taskId, progress, summary, client)
              )
            : taskId === 'region_rankings'
              ? await runRegionRankingsTask(client, (progress, summary) =>
                  updateTaskProgress(taskId, progress, summary, client)
                )
              : await runUniversityStatsTask(client, (progress, summary) =>
                  updateTaskProgress(taskId, progress, summary, client)
                );

        await finishTaskRun(
          taskId,
          startedAt,
          'succeeded',
          {
            progress: result.progress,
            summary: result.summary
          },
          client
        );
      } catch (error) {
        console.error(`Data update task failed: ${taskId}`, error);
        await finishTaskRun(taskId, startedAt, 'failed', { error }, client);
      }
    })();
  });
};

export const triggerDataUpdate = async (
  taskId: DataUpdateTaskId,
  trigger: DataUpdateTriggerContext,
  client: MongoClient = mongo
): Promise<TriggerDataUpdateResult> => {
  const claimResult = await claimTaskRun(taskId, trigger, client);

  if (claimResult.started && !claimResult.alreadyRunning) {
    runTaskInBackground(taskId, claimResult.task.startedAt ?? new Date(), client);
  }

  return claimResult;
};

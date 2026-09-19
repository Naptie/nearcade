/**
 * ── openmetro Sync Core ────────────────────────────────────────────────────
 * Fetches networks + per-network reference data from the openmetro API and
 * runs the four sync phases (fetch & version → persist → assign → rankings)
 * against the metro_* Mongo collections. Script-safe: everything is injected
 * (MongoClient, base URL) — no SvelteKit-only imports — so
 * `scripts/verify-metro.ts` drives the exact same code the admin task runs.
 *
 * Written ONLY here; everything downstream (snapshot cache, discover, future
 * rankings API) reads the persisted collections.
 */
import { createHash } from 'node:crypto';
import type { AnyBulkWriteOperation, Collection, Document, MongoClient } from 'mongodb';
import { createClient } from 'openmetro-client';
import {
  GAME_TITLES,
  METRO_ACCESS_MAX_KM,
  METRO_RANKING_RADIUS_OPTIONS,
  metroRankingSortKey
} from '$lib/constants';
import type { MetroStationRanking, ShopMetro } from '$lib/schemas/metro';
import type { RankingMetrics } from '$lib/schemas/rankings';
import { calculateDistanceKm, computeWalkSeconds, snapToStation } from './graph.server';
import { invalidateMetroSnapshot } from './snapshot.server';
import {
  parseOpenMetroGraph,
  parseOpenMetroLines,
  parseOpenMetroNetworks,
  parseOpenMetroPatterns,
  parseOpenMetroStations,
  type MetroEdgeDoc,
  type MetroLineDoc,
  type MetroPatternDoc,
  type MetroStationDoc,
  type OpenMetroNetwork,
  type PlacedOpenMetroStation
} from './schemas';

export interface OpenMetroSyncProgress {
  processed: number;
  total: number | null;
}

export type OpenMetroSyncSummary = Record<string, number | string | boolean | null>;

export interface OpenMetroSyncResult {
  progress: OpenMetroSyncProgress;
  summary: OpenMetroSyncSummary;
}

export interface RunOpenMetroSyncOptions {
  client: MongoClient;
  baseUrl: string;
  /** Re-fetch / re-persist unchanged reference data; shops and rankings always refresh. */
  force?: boolean;
  reportProgress?: (
    progress: OpenMetroSyncProgress,
    summary?: OpenMetroSyncSummary | null
  ) => Promise<void>;
}

const FETCH_TIMEOUT_MS = 30 * 1000;
const RANKINGS_CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const BULK_CHUNK_SIZE = 500;

/**
 * Doc-shape version of the persisted metro collections. Bump whenever the
 * persisted document layout changes (e.g. v2: `lnub` → `shortName`, upstream
 * `synced_at` recorded; v3: multilingual `names` on networks/lines and
 * per-radius station rankings) — a mismatch forces a full re-persist even
 * when the upstream data version (`synced_at`) is unchanged, so stale-shaped
 * docs can never survive a deploy.
 */
const METRO_DOC_SCHEMA_VERSION = 3;

/**
 * Campus-parity ranking helpers. Mirrors the campus task's
 * `getShopsWithinRadius`/`calculateMetricsForRadius` in
 * `$lib/admin/data-updates.server.ts`, kept local so the sync stays
 * script-safe (no SvelteKit-only import chain).
 */
interface RankableShop {
  id: number;
  location?: { coordinates?: [number, number] | null } | null;
  games?: Array<{ titleId: number; quantity: number }> | null;
}

const getShopsWithinRadius = (
  shops: RankableShop[],
  stationLon: number,
  stationLat: number,
  radiusKm: number
): RankableShop[] =>
  shops.filter((shop) => {
    const [lng, lat] = shop.location?.coordinates ?? [];
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      calculateDistanceKm(stationLat, stationLon, lat as number, lng as number) <= radiusKm
    );
  });

const countGameMachines = (shops: RankableShop[], titleId: number): number =>
  shops.reduce(
    (total, shop) => total + (shop.games?.find((game) => game.titleId === titleId)?.quantity || 0),
    0
  );

const calculateMetricsForRadius = (shops: RankableShop[], radiusKm: number): RankingMetrics => {
  const totalMachines = shops.reduce(
    (total, shop) =>
      total + (shop.games?.reduce((sum, game) => sum + (game.quantity || 0), 0) ?? 0),
    0
  );
  return {
    radius: radiusKm,
    shopCount: shops.length,
    totalMachines,
    // Straight-line radius areas are exact circles (unlike region polygons),
    // so density is always defined — matching campus behaviour for campuses.
    areaDensity: totalMachines / (Math.PI * radiusKm * radiusKm),
    machinesPerCapita: null,
    gameSpecificMachines: GAME_TITLES.map((game) => ({
      name: game.key,
      quantity: countGameMachines(shops, game.id)
    }))
  };
};

const runBulkWrite = async (
  collection: Collection<Document>,
  ops: AnyBulkWriteOperation<Document>[]
) => {
  for (let i = 0; i < ops.length; i += BULK_CHUNK_SIZE) {
    await collection.bulkWrite(ops.slice(i, i + BULK_CHUNK_SIZE) as never[]);
  }
};

/**
 * Replace a network's documents in one collection: upsert everything current,
 * delete anything stale from a previous sync of the same network.
 */
const replaceNetworkDocs = async <T extends { _id: string; networkId: string }>(
  collection: Collection<Document>,
  networkId: string,
  docs: T[]
) => {
  const ops = docs.map((doc) => ({
    replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true }
  })) as unknown as AnyBulkWriteOperation<Document>[];
  if (docs.length > 0) {
    ops.push({
      deleteMany: { filter: { networkId, _id: { $nin: docs.map((doc) => doc._id) } } }
    } as unknown as AnyBulkWriteOperation<Document>);
  }
  await runBulkWrite(collection, ops);
};

const runOpenMetroSync = async (options: RunOpenMetroSyncOptions): Promise<OpenMetroSyncResult> => {
  const { client, baseUrl, force = false, reportProgress } = options;
  const db = client.db();

  const metro = createClient(baseUrl, {
    // Eden's config key for a custom fetch function; cap every request so a
    // hung openmetro request cannot stall the task until its own timeout.
    fetcher: ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })) as typeof fetch
  });

  // ── Phase 1: fetch & version ───────────────────────────────────────────────
  const networksResponse = await metro.api.networks.get();
  if (networksResponse.error || !networksResponse.data) {
    throw new Error(
      `openmetro: failed to list networks: ${JSON.stringify(networksResponse.error)}`
    );
  }

  const networks = parseOpenMetroNetworks(networksResponse.data);

  await reportProgress?.({ processed: 0, total: null });

  interface FetchedNetwork {
    network: OpenMetroNetwork;
    stationDocs: MetroStationDoc[];
    lineDocs: MetroLineDoc[];
    patternDocs: MetroPatternDoc[];
    edgeDocs: MetroEdgeDoc[];
    stationsHash: string | null;
    syncedAt: string | null;
    unchanged: boolean;
  }

  /** Rehydrate a network skipped by the version fast-path from Mongo, so the
   * flat assignment + rankings phases still see the complete global dataset. */
  const rehydrateSkipped = async (network: OpenMetroNetwork, syncedAt: string) => {
    const [stationDocs, lineDocs, patternDocs, edgeDocs, meta] = await Promise.all([
      db.collection<MetroStationDoc>('metro_stations').find({ networkId: network.id }).toArray(),
      db.collection<MetroLineDoc>('metro_lines').find({ networkId: network.id }).toArray(),
      db.collection<MetroPatternDoc>('metro_patterns').find({ networkId: network.id }).toArray(),
      db.collection<MetroEdgeDoc>('metro_edges').find({ networkId: network.id }).toArray(),
      db
        .collection('openmetro_networks')
        .findOne({ _id: network.id } as never, { projection: { stationsHash: 1 } })
    ]);
    const entry: FetchedNetwork = {
      network,
      stationDocs,
      lineDocs,
      patternDocs,
      edgeDocs,
      stationsHash: (meta as { stationsHash?: string } | null)?.stationsHash ?? null,
      syncedAt,
      unchanged: true
    };
    fetched.push(entry);
    return entry;
  };

  const fetched: FetchedNetwork[] = [];

  for (const network of networks) {
    // Detail route first: `synced_at` (r10+) is the upstream data version.
    // When it matches the last successful sync AND the persisted docs are in
    // the current doc-shape version, the ~270 KB of per-network reference
    // fetches can be skipped entirely (unless forced) — the sha256
    // comparison below remains as the fallback detector for APIs that do
    // not publish it. Eden deserializes the ISO wire string into a Date —
    // normalize both.
    const detailRes = await metro.api.networks({ id: network.id }).get();
    if (detailRes.error || !detailRes.data || 'error' in detailRes.data) {
      throw new Error(
        `openmetro: failed to fetch network detail for ${network.id}: ${JSON.stringify(detailRes.error)}`
      );
    }
    const syncedAtValue = ('synced_at' in detailRes.data ? detailRes.data.synced_at : undefined) as
      string | Date | undefined;
    const syncedAt =
      syncedAtValue === undefined
        ? null
        : syncedAtValue instanceof Date
          ? syncedAtValue.toISOString()
          : syncedAtValue;

    if (!force && syncedAt !== null) {
      const existing = (await db
        .collection('openmetro_networks')
        .findOne({ _id: network.id } as never)) as {
        syncedAt?: string | null;
        schemaVersion?: number;
      } | null;
      if (existing?.syncedAt === syncedAt && existing?.schemaVersion === METRO_DOC_SCHEMA_VERSION) {
        // Version match — skip the reference fetches but keep the network in
        // the dataset (rehydrated from Mongo) so flat assignment/rankings see
        // the complete global station set.
        await rehydrateSkipped(network, syncedAt);
        continue;
      }
    }

    const [stationsRes, linesRes, patternsRes, graphRes] = await Promise.all([
      metro.api.networks({ id: network.id }).stations.get(),
      metro.api.networks({ id: network.id }).lines.get(),
      metro.api.networks({ id: network.id }).patterns.get(),
      metro.api.networks({ id: network.id }).graph.get({ query: { weight: 'time' } })
    ]);
    for (const [name, res] of [
      ['stations', stationsRes],
      ['lines', linesRes],
      ['patterns', patternsRes],
      ['graph', graphRes]
    ] as const) {
      if (res.error || !res.data) {
        throw new Error(
          `openmetro: failed to fetch ${name} for ${network.id}: ${JSON.stringify(res.error)}`
        );
      }
    }

    const stations = parseOpenMetroStations(stationsRes.data);
    const lines = parseOpenMetroLines(linesRes.data);
    const patterns = parseOpenMetroPatterns(patternsRes.data);
    const graph = parseOpenMetroGraph(graphRes.data);

    // All placed stations are persisted and enter the routing graph — the
    // live API routes through out-of-service stations (verified against
    // v0.1.0-r3), so excluding them would break travel-time parity with the
    // ground-truth isochrones. Snapping (shop assignment + origin entry)
    // stays operating-only; every doc carries `status` for consumers.
    const placeableStations = stations.filter(
      (station): station is PlacedOpenMetroStation => station.location !== undefined
    );
    const stationById = new Map(placeableStations.map((station) => [station.id, station] as const));
    const stationByStop = new Map(graph.nodes.map((node) => [node.id, node.station_id] as const));

    const stationDocs: MetroStationDoc[] = placeableStations.map((station) => ({
      _id: station.id,
      networkId: network.id,
      name: station.name,
      names: station.names,
      lon: station.location.lon,
      lat: station.location.lat,
      status: station.status,
      lineIds: station.lines,
      isInterchange: station.is_interchange
    }));

    const lineDocs: MetroLineDoc[] = lines.map((line) => ({
      _id: line.id,
      networkId: network.id,
      name: line.name,
      names: line.names,
      color: line.color ?? null,
      mode: line.mode,
      loop: line.loop,
      shortName: line.short_name
    }));

    const patternDocs: MetroPatternDoc[] = patterns.map((pattern) => ({
      _id: pattern.id,
      networkId: network.id,
      lineId: pattern.line_id,
      stopIds: pattern.stop_ids,
      terminalStationId: stationByStop.get(pattern.terminal_stop_id) ?? null
    }));

    const edgeDocs: MetroEdgeDoc[] = graph.edges.flatMap((edge) => {
      const fromStationId = stationByStop.get(edge.from);
      const toStationId = stationByStop.get(edge.to);
      if (!fromStationId || !toStationId) return [];
      // Any placed station participates — out-of-service stops stay routable
      // (live-API parity, verified against v0.1.0-r10); snapping filters.
      if (!stationById.has(fromStationId) || !stationById.has(toStationId)) return [];
      if (edge.seconds === undefined) return [];
      return [
        {
          _id: `${network.id}:${edge.from}:${edge.to}:${edge.kind}`,
          networkId: network.id,
          kind: edge.kind,
          from: edge.from,
          to: edge.to,
          fromStationId,
          toStationId,
          lineId: edge.line_id ?? null,
          seconds: edge.seconds,
          distanceKm: edge.distance_km ?? null
        }
      ];
    });

    const stationsHash = createHash('sha256').update(JSON.stringify(stationDocs)).digest('hex');
    // Upstream version first (r10+): an unchanged `synced_at` proves no data
    // change, so the sha256 comparison only runs as the fallback detector.
    // Either way, a persisted doc-shape mismatch (schemaVersion) always
    // forces a re-persist — stale-shaped docs never survive an upgrade.
    const existing = (await db
      .collection('openmetro_networks')
      .findOne({ _id: network.id } as never)) as {
      stationsHash?: string;
      syncedAt?: string | null;
      schemaVersion?: number;
    } | null;
    const dataUnchanged =
      (syncedAt !== null && syncedAt === existing?.syncedAt) ||
      existing?.stationsHash === stationsHash;
    const unchanged = dataUnchanged && existing?.schemaVersion === METRO_DOC_SCHEMA_VERSION;

    fetched.push({
      network,
      stationDocs,
      lineDocs,
      patternDocs,
      edgeDocs,
      stationsHash,
      syncedAt,
      unchanged
    });
  }

  const stationCount = fetched.reduce((sum, entry) => sum + entry.stationDocs.length, 0);
  const lineCount = fetched.reduce((sum, entry) => sum + entry.lineDocs.length, 0);
  const patternCount = fetched.reduce((sum, entry) => sum + entry.patternDocs.length, 0);
  const edgeCount = fetched.reduce((sum, entry) => sum + entry.edgeDocs.length, 0);

  // ── Phase 2: persist ───────────────────────────────────────────────────────
  const now = new Date();
  for (const entry of fetched) {
    // Skip only reference writes. Shop locations/games can change independently
    // of upstream versions, so assignment and rankings must always run below.
    // A doc-shape mismatch already makes entry.unchanged false in phase 1.
    if (entry.unchanged && !force) continue;

    await replaceNetworkDocs(db.collection('metro_stations'), entry.network.id, entry.stationDocs);
    await replaceNetworkDocs(db.collection('metro_lines'), entry.network.id, entry.lineDocs);
    await replaceNetworkDocs(db.collection('metro_patterns'), entry.network.id, entry.patternDocs);
    await replaceNetworkDocs(db.collection('metro_edges'), entry.network.id, entry.edgeDocs);

    await db.collection('openmetro_networks').replaceOne(
      { _id: entry.network.id } as never,
      {
        _id: entry.network.id,
        name: entry.network.name,
        names: entry.network.names,
        cityRegionId: entry.network.city.id,
        schemaVersion: METRO_DOC_SCHEMA_VERSION,
        syncedAt: entry.syncedAt,
        stationsHash: entry.stationsHash,
        stationCount: entry.stationDocs.length,
        lastSyncedAt: now
      } as never,
      { upsert: true }
    );
  }

  await reportProgress?.(
    { processed: 1, total: null },
    {
      stationCount,
      lineCount,
      patternCount,
      edgeCount
    }
  );

  // ── Phase 3: assign (flat, across all networks) ───────────────────────────
  // Assignment candidates are operating stations only — out-of-service stops
  // stay in the routing graph for time parity but must never host a shop.
  const allStationDocs = fetched
    .flatMap((entry) => entry.stationDocs)
    .filter((station) => station.status === 'operating');
  const lineDocsById = new Map(
    fetched.flatMap((entry) => entry.lineDocs).map((line) => [line._id, line] as const)
  );

  const stationLineBadges = (station: MetroStationDoc): ShopMetro['lines'] =>
    station.lineIds.flatMap((lineId) => {
      const line = lineDocsById.get(lineId);
      return line
        ? [
            {
              id: line._id,
              name: line.name,
              names: line.names,
              color: line.color,
              shortName: line.shortName
            }
          ]
        : [];
    });

  interface AssignableShop {
    id: number;
    location?: { coordinates?: [number, number] | null } | null;
    transit?: { metro?: ShopMetro | null } | null;
    games?: Array<{ titleId: number; quantity: number }> | null;
  }
  const shops = (await db
    .collection('shops')
    .find({}, { projection: { id: 1, location: 1, transit: 1, games: 1 } })
    .toArray()) as unknown as AssignableShop[];

  const shopOps: Array<
    | { updateOne: { filter: { id: number }; update: { $set: { 'transit.metro': ShopMetro } } } }
    | { updateOne: { filter: { id: number }; update: { $unset: { 'transit.metro': string } } } }
  > = [];
  const assigned = new Map<string, { station: MetroStationDoc; shops: AssignableShop[] }>();

  for (const shop of shops) {
    const [lng, lat] = shop.location?.coordinates ?? [];
    const snap =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? snapToStation(allStationDocs, lat as number, lng as number, METRO_ACCESS_MAX_KM)
        : null;

    const nextMetro: ShopMetro | null = snap
      ? {
          networkId: snap.station.networkId,
          stationId: snap.station._id,
          stationName: snap.station.name,
          names: snap.station.names,
          walkSeconds: computeWalkSeconds(snap.distanceKm),
          distanceKm: Math.round(snap.distanceKm * 1000) / 1000,
          lines: stationLineBadges(snap.station)
        }
      : null;

    if (JSON.stringify(shop.transit?.metro ?? null) !== JSON.stringify(nextMetro)) {
      shopOps.push(
        nextMetro
          ? {
              updateOne: {
                filter: { id: shop.id },
                update: { $set: { 'transit.metro': nextMetro } }
              }
            }
          : {
              updateOne: {
                filter: { id: shop.id },
                update: { $unset: { 'transit.metro': '' } }
              }
            }
      );
    }

    if (snap) {
      const group = assigned.get(snap.station._id);
      if (group) {
        group.shops.push(shop);
      } else {
        assigned.set(snap.station._id, { station: snap.station, shops: [shop] });
      }
    }
  }

  await runBulkWrite(
    db.collection('shops'),
    shopOps as unknown as AnyBulkWriteOperation<Document>[]
  );

  await reportProgress?.(
    { processed: shops.length, total: shops.length },
    { updatedShops: shopOps.length }
  );

  // ── Phase 4: rebuild metro station rankings from the same pass ────────────
  const rankingsCollection = db.collection('metro_station_rankings');
  const existingMetadata = (await rankingsCollection.findOne({ _id: 'metadata' } as never)) as {
    createdAt?: Date;
    networks?: Array<{
      id: string;
      name: string;
      names?: { zh: string; en: string };
      stationCount: number;
    }>;
  } | null;
  // Keep the last published network list available while rebuilding or on failure.
  const metadataNetworks =
    existingMetadata?.networks ??
    fetched.map((entry) => ({
      id: entry.network.id,
      name: entry.network.name,
      names: entry.network.names,
      stationCount: 0
    }));
  await rankingsCollection.replaceOne(
    { _id: 'metadata' } as never,
    {
      _id: 'metadata',
      createdAt: existingMetadata?.createdAt ?? now,
      expiresAt: new Date(Date.now() - 1),
      totalCount: 0,
      isCalculating: true,
      calculationStarted: now,
      networks: metadataNetworks
    } as never,
    { upsert: true }
  );

  try {
    await rankingsCollection.deleteMany({ _id: { $ne: 'metadata' } } as never);

    // Campus-parity model (§3.6): each station carries per-radius metrics over
    // ALL shops by straight-line distance, exactly like campus rankings. The
    // smallest radius equals the snapping cutoff, so its shop/machine counts
    // agree with the persisted assignments; larger radii are straight-line
    // caches built from the same shop projection — no extra reads.
    const sortCriteria = ['shops', 'machines', ...GAME_TITLES.map((game) => game.key)] as const;
    const rankings: MetroStationRanking[] = [];

    for (const [stationId, group] of assigned) {
      const { station } = group;
      rankings.push({
        id: `${station.networkId}:${stationId}`,
        _id: `${station.networkId}:${stationId}`,
        networkId: station.networkId,
        stationId,
        name: station.name,
        names: station.names,
        lines: stationLineBadges(station),
        location: { lon: station.lon, lat: station.lat },
        rankings: METRO_RANKING_RADIUS_OPTIONS.map((radius) =>
          calculateMetricsForRadius(
            getShopsWithinRadius(shops, station.lon, station.lat, radius),
            radius
          )
        ),
        rankOrder: {}
      });
    }

    for (const sortBy of sortCriteria) {
      for (const radius of METRO_RANKING_RADIUS_OPTIONS) {
        // Dot-safe key: Mongo paths split on '.', so decimal radii are encoded
        // in centimetres (see metroRankingSortKey).
        const sortKey = metroRankingSortKey(sortBy, radius);
        const sorted = [...rankings].sort((left, right) => {
          const leftMetrics = left.rankings.find((entry) => entry.radius === radius);
          const rightMetrics = right.rankings.find((entry) => entry.radius === radius);
          if (!leftMetrics || !rightMetrics) return 0;
          let difference: number;
          switch (sortBy) {
            case 'shops':
              difference = rightMetrics.shopCount - leftMetrics.shopCount;
              break;
            case 'machines':
              difference = rightMetrics.totalMachines - leftMetrics.totalMachines;
              break;
            default: {
              const leftQuantity =
                leftMetrics.gameSpecificMachines.find((entry) => entry.name === sortBy)?.quantity ??
                0;
              const rightQuantity =
                rightMetrics.gameSpecificMachines.find((entry) => entry.name === sortBy)
                  ?.quantity ?? 0;
              difference = rightQuantity - leftQuantity;
            }
          }
          // Locale-independent ID order keeps tied ranks stable across shop read orders.
          return difference || (left._id < right._id ? -1 : left._id > right._id ? 1 : 0);
        });
        sorted.forEach((ranking, index) => {
          ranking.rankOrder[sortKey] = index + 1;
        });
      }
    }

    if (rankings.length > 0) {
      await rankingsCollection.insertMany(rankings as never[]);
    }

    await rankingsCollection.replaceOne(
      { _id: 'metadata' } as never,
      {
        _id: 'metadata',
        createdAt: now,
        expiresAt: new Date(Date.now() + RANKINGS_CACHE_DURATION_MS),
        totalCount: rankings.length,
        isCalculating: false,
        calculationStarted: undefined,
        networks: fetched.map((entry) => ({
          id: entry.network.id,
          name: entry.network.name,
          names: entry.network.names,
          stationCount: rankings.filter((ranking) => ranking.networkId === entry.network.id).length
        }))
      } as never,
      { upsert: true }
    );
  } catch (error) {
    await rankingsCollection.replaceOne(
      { _id: 'metadata' } as never,
      {
        _id: 'metadata',
        createdAt: existingMetadata?.createdAt ?? now,
        expiresAt: new Date(Date.now() - 1),
        totalCount: 0,
        isCalculating: false,
        calculationStarted: undefined,
        networks: metadataNetworks
      } as never,
      { upsert: true }
    );
    throw error;
  }

  // Serving isolates pick up the new data via the version re-check; this one
  // can switch immediately.
  invalidateMetroSnapshot();

  return {
    progress: { processed: shops.length, total: shops.length },
    summary: {
      unchanged: false,
      networkCount: fetched.length,
      stationCount,
      lineCount,
      patternCount,
      edgeCount,
      assignedCount: [...assigned.values()].reduce((sum, group) => sum + group.shops.length, 0),
      unassignedCount:
        shops.length - [...assigned.values()].reduce((sum, group) => sum + group.shops.length, 0),
      updatedShops: shopOps.length,
      rankingCount: assigned.size
    }
  };
};

export { runOpenMetroSync };

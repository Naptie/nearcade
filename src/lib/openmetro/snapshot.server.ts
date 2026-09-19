/**
 * ── Metro Snapshot Server Utilities ────────────────────────────────────────
 * Loads the persisted openmetro collections (openmetro_networks +
 * metro_stations/lines/patterns/edges) from MongoDB into module-level
 * in-memory maps (mirrors `initRegionCache`), rebuilt lazily when the
 * persisted version (max `lastSyncedAt`) advances — re-checked at most once
 * per minute. Written only by the openmetro sync task.
 *
 * **Import safety**: this module (and `graph.server.ts` / `route.server.ts`)
 * must stay importable outside SvelteKit — `scripts/verify-metro.ts` drives
 * the exact same code. Pass the `MongoClient` in explicitly; never import
 * `$lib/db/index.server` or `$env/*` here.
 */
import type { MongoClient } from 'mongodb';
import type {
  MetroEdgeDoc,
  MetroLineDoc,
  MetroPatternDoc,
  MetroNetworkDoc,
  MetroStationDoc
} from './schemas';

export interface MetroSnapshotNetwork {
  id: string;
  name: string;
  /** openmetro ApiNames contract: zh + en both mandatory. */
  names: { zh: string; en: string };
  cityRegionId: string;
}

export interface MetroSnapshot {
  /** Max `lastSyncedAt` across persisted networks (epoch ms). */
  versionMs: number;
  networks: MetroSnapshotNetwork[];
  /**
   * Flat stations across all networks. Includes out-of-service stations
   * (routing parity with the live API); use `operatingStations` for snapping.
   */
  stations: MetroStationDoc[];
  /** `stations` filtered to `status === 'operating'` — assignment/origin candidates. */
  operatingStations: MetroStationDoc[];
  stationsById: Map<string, MetroStationDoc>;
  linesById: Map<string, MetroLineDoc>;
  patternsByLine: Map<string, MetroPatternDoc[]>;
  /** Outgoing edges per stop id; ride edges exist in both directions. */
  adjacency: Map<string, MetroEdgeDoc[]>;
  /** stopId → stationId (only stops touched by at least one edge). */
  stopStation: Map<string, string>;
  /** stationId → stop ids (Dijkstra entry points). */
  stopsByStation: Map<string, string[]>;
}

const VERSION_RECHECK_INTERVAL_MS = 60 * 1000;

let snapshot: MetroSnapshot | null = null;
let building: Promise<MetroSnapshot> | null = null;
let lastVersionCheckMs = 0;

/** Drop the in-memory snapshot so the next metro request rebuilds from Mongo. */
export const invalidateMetroSnapshot = (): void => {
  snapshot = null;
  lastVersionCheckMs = 0;
};

const readSnapshotVersionMs = async (client: MongoClient): Promise<number> => {
  const docs = await client
    .db()
    .collection<MetroNetworkDoc>('openmetro_networks')
    .find({}, { projection: { lastSyncedAt: 1 } })
    .toArray();
  return docs.reduce((max, doc) => Math.max(max, doc.lastSyncedAt?.getTime() ?? 0), 0);
};

const buildSnapshot = async (client: MongoClient): Promise<MetroSnapshot> => {
  const db = client.db();
  const [networkDocs, stationDocs, lineDocs, patternDocs, edgeDocs] = await Promise.all([
    db.collection<MetroNetworkDoc>('openmetro_networks').find({}).toArray(),
    db.collection<MetroStationDoc>('metro_stations').find({}).toArray(),
    db.collection<MetroLineDoc>('metro_lines').find({}).toArray(),
    db.collection<MetroPatternDoc>('metro_patterns').find({}).toArray(),
    db.collection<MetroEdgeDoc>('metro_edges').find({}).toArray()
  ]);

  const stationsById = new Map(stationDocs.map((station) => [station._id, station] as const));
  const linesById = new Map(lineDocs.map((line) => [line._id, line] as const));

  const patternsByLine = new Map<string, MetroPatternDoc[]>();
  for (const pattern of patternDocs) {
    const bucket = patternsByLine.get(pattern.lineId);
    if (bucket) {
      bucket.push(pattern);
    } else {
      patternsByLine.set(pattern.lineId, [pattern]);
    }
  }

  const adjacency = new Map<string, MetroEdgeDoc[]>();
  const stopStation = new Map<string, string>();
  const addEdge = (edge: MetroEdgeDoc) => {
    const bucket = adjacency.get(edge.from);
    if (bucket) {
      bucket.push(edge);
    } else {
      adjacency.set(edge.from, [edge]);
    }
    stopStation.set(edge.from, edge.fromStationId);
    stopStation.set(edge.to, edge.toStationId);
  };

  for (const edge of edgeDocs) {
    addEdge(edge);
    if (edge.kind === 'ride') {
      // The API stores one ride edge per adjacent stop pair (verified against
      // v0.1.0-r3: 0 reverse pairs) — traverse rides in both directions;
      // transfers keep their (already symmetric) directional walk times.
      addEdge({
        ...edge,
        from: edge.to,
        to: edge.from,
        fromStationId: edge.toStationId,
        toStationId: edge.fromStationId
      });
    }
  }

  const stopsByStation = new Map<string, string[]>();
  for (const [stopId, stationId] of stopStation) {
    const bucket = stopsByStation.get(stationId);
    if (bucket) {
      bucket.push(stopId);
    } else {
      stopsByStation.set(stationId, [stopId]);
    }
  }

  return {
    versionMs: networkDocs.reduce((max, doc) => Math.max(max, doc.lastSyncedAt?.getTime() ?? 0), 0),
    networks: networkDocs.map((doc) => ({
      id: doc._id,
      name: doc.name,
      names: doc.names,
      cityRegionId: doc.cityRegionId
    })),
    stations: stationDocs,
    operatingStations: stationDocs.filter((station) => station.status === 'operating'),
    stationsById,
    linesById,
    patternsByLine,
    adjacency,
    stopStation,
    stopsByStation
  };
};

export const initMetroSnapshot = async (client: MongoClient): Promise<MetroSnapshot> => {
  if (snapshot) return snapshot;
  building ??= buildSnapshot(client)
    .then((built) => {
      snapshot = built;
      lastVersionCheckMs = Date.now();
      console.log(
        '[Metro Snapshot] Loaded',
        built.stations.length,
        'stations across',
        built.networks.length,
        'networks'
      );
      return built;
    })
    .finally(() => {
      building = null;
    });
  return building;
};

export const getMetroSnapshot = async (client: MongoClient): Promise<MetroSnapshot> => {
  if (snapshot && Date.now() - lastVersionCheckMs >= VERSION_RECHECK_INTERVAL_MS) {
    const versionMs = await readSnapshotVersionMs(client);
    lastVersionCheckMs = Date.now();
    if (versionMs > snapshot.versionMs) {
      snapshot = null;
    }
  }
  return initMetroSnapshot(client);
};

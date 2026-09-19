/**
 * TypeScript types for the Mongo documents the openmetro sync task persists.
 *
 * The wire contract comes from openmetro itself on both levels (r10+): the
 * Eden-inferred entity types from `openmetro-client` for compile time, and
 * the generated zod schemas in `openmetro-client/schemas` for runtime
 * validation at the sync boundary — zero hand-written duplication here. The
 * types below are nearcade's denormalized serving shapes (written only by the
 * sync task; everything downstream — snapshot cache, discover, future
 * rankings API — reads the collections).
 */
import type {
  ApiLine,
  ApiNetwork,
  ApiPattern,
  ApiStation,
  ApiSuccess,
  Client
} from 'openmetro-client';
import {
  apiLineListSchema,
  apiNetworkListSchema,
  apiPatternListSchema,
  apiStationListSchema,
  apiStopGraphSchema
} from 'openmetro-client/schemas';

// ── Fetched API payload types (inferred from the typed client) ──────────────

type NetworkRoute = ReturnType<Client['api']['networks']>;

export type { ApiNetwork as OpenMetroNetwork };
export type { ApiStation as OpenMetroStation };
export type { ApiLine as OpenMetroLine };
export type { ApiPattern as OpenMetroPattern };
/** `GET /api/networks/{id}/graph?weight=time` payload. */
export type OpenMetroGraph = ApiSuccess<NetworkRoute['graph']['get']>;
/** `OpenMetroStation` narrowed to the variant that has geospatial coordinates. */
export type PlacedOpenMetroStation = ApiStation & {
  location: NonNullable<ApiStation['location']>;
};

// ── Runtime validation (openmetro's generated zod schemas) ──────────────────

/**
 * The generated `schemas.d.ts` declares zod-3 style generics, which do not
 * type-check under nearcade's zod 4 (runtime is fully compatible — verified
 * against the live API), so `parse` collapses to `any`. These facades re-attach
 * the client-inferred types; the validation logic itself is entirely the
 * package's — shapes are not restated, only the parse signatures.
 */
interface Parser<T> {
  parse: (data: unknown) => T;
}

export const parseOpenMetroNetworks = (data: unknown): ApiNetwork[] =>
  (apiNetworkListSchema as unknown as Parser<{ networks: ApiNetwork[] }>).parse(data).networks;
export const parseOpenMetroStations = (data: unknown): ApiStation[] =>
  (apiStationListSchema as unknown as Parser<ApiStation[]>).parse(data);
export const parseOpenMetroLines = (data: unknown): ApiLine[] =>
  (apiLineListSchema as unknown as Parser<ApiLine[]>).parse(data);
export const parseOpenMetroPatterns = (data: unknown): ApiPattern[] =>
  (apiPatternListSchema as unknown as Parser<ApiPattern[]>).parse(data);
export const parseOpenMetroGraph = (data: unknown): OpenMetroGraph =>
  (apiStopGraphSchema as unknown as Parser<OpenMetroGraph>).parse(data);

// ── Persisted document types (written only by the sync task) ────────────────

export interface MetroStationDoc {
  _id: string;
  networkId: string;
  name: string;
  names: { zh: string; en: string };
  lon: number;
  lat: number;
  status: string;
  lineIds: string[];
  isInterchange: boolean;
}

export interface MetroLineDoc {
  _id: string;
  networkId: string;
  name: string;
  names: { zh: string; en: string };
  color: string | null;
  mode: string;
  loop: boolean;
  /**
   * Official compact display code from the API (`line.short_name`, r10+):
   * "1", "10", "S1", "亦庄T1", "APM"… Resolved upstream from operator data,
   * never derived here. Present on every line (API-mandated non-empty).
   */
  shortName: string;
}

export interface MetroPatternDoc {
  _id: string;
  networkId: string;
  lineId: string;
  stopIds: string[];
  /** Station id of the terminal stop; null when it could not be resolved. */
  terminalStationId: string | null;
}

export interface MetroEdgeDoc {
  _id: string;
  networkId: string;
  kind: 'ride' | 'transfer';
  from: string;
  to: string;
  /** Denormalized station ids for both endpoints (saves a stop→station join). */
  fromStationId: string;
  toStationId: string;
  lineId: string | null;
  seconds: number;
  distanceKm: number | null;
}

export interface MetroNetworkDoc {
  _id: string;
  name: string;
  /** openmetro ApiNames contract: zh + en both mandatory. */
  names: { zh: string; en: string };
  cityRegionId: string;
  /**
   * Persisted doc-shape version (`schemaVersion` in the stored doc). A bump
   * forces a full re-persist even when the upstream data is unchanged, so
   * stale-shaped docs never survive a deploy.
   */
  schemaVersion?: number;
  /**
   * Upstream data version (`synced_at` from the network detail route, r10+),
   * when published. Null only when the API omits it — then the sha256
   * fingerprint below remains the change detector.
   */
  syncedAt: string | null;
  /** sha256 of the station docs — change fingerprint + `synced_at` fallback. */
  stationsHash: string | null;
  stationCount: number;
  lastSyncedAt: Date;
}

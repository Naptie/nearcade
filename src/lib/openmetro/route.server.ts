/**
 * ── Metro Route Server Utilities ───────────────────────────────────────────
 * Reconstructs per-shop itineraries from a Dijkstra result and assembles the
 * ready-to-serve `metro` block embedded in the discover response (§3.4 of the
 * integration plan). The browser renders hover polylines and the Directions
 * panel from this block alone — zero client-side openmetro calls for routing.
 */
import type { ShopMetro } from '$lib/schemas/metro';
import { computeMetroTripSeconds } from '$lib/utils/travel';
import type { MetroEdgeDoc } from './schemas';
import { computeWalkSeconds, type MetroDijkstra, type MetroSnapResult } from './graph.server';
import type { MetroSnapshot } from './snapshot.server';

export interface MetroLegPlan {
  kind: 'ride' | 'transfer';
  lineId?: string;
  /** Station ids visited in order (ride legs include both endpoints). */
  stationIds: string[];
  seconds: number;
  distanceKm?: number;
  /** Terminal station name for ride legs (往 X), when resolvable from patterns. */
  direction?: string;
}

export interface MetroShopItinerary {
  totalSeconds: number;
  rideSeconds: number;
  transferCount: number;
  legs: MetroLegPlan[];
}

export interface DiscoverMetroBlock {
  network: {
    id: string;
    name: string;
    names: { zh: string; en: string };
    cityRegionId: string;
  };
  origin: {
    stationId: string;
    stationName: string;
    names: { zh: string; en: string };
    walkSeconds: number;
    /** Search-origin coordinates, not the snapped station's coordinates. */
    lon: number;
    lat: number;
  };
  /** Referenced lines only, keyed by line id (same shape as `shop.transit.metro.lines`). */
  lines: Record<
    string,
    {
      id: string;
      name: string;
      names: { zh: string; en: string };
      color: string | null;
      shortName: string;
    }
  >;
  /** Referenced stations only, keyed by station id. */
  stations: Record<
    string,
    { name: string; names: { zh: string; en: string }; lon: number; lat: number }
  >;
  /** Itineraries keyed by shop id (stringified). */
  shops: Record<string, MetroShopItinerary>;
}

/** Total travel time = access walk + entry + in-system + exit + egress walk. */
export const computeTotalSeconds = computeMetroTripSeconds;

/**
 * Resolve a ride leg's direction label: the first pattern of the line whose
 * stop sequence contains the leg's stops as a contiguous increasing run, and
 * whose terminal station can be named.
 */
const findRideDirection = (
  snapshot: MetroSnapshot,
  lineId: string,
  stopIds: string[]
): string | undefined => {
  for (const pattern of snapshot.patternsByLine.get(lineId) ?? []) {
    const indexByStop = new Map<string, number>();
    pattern.stopIds.forEach((stopId, index) => {
      if (!indexByStop.has(stopId)) indexByStop.set(stopId, index);
    });

    let cursor = indexByStop.get(stopIds[0]);
    if (cursor === undefined) continue;

    let contiguous = true;
    for (let i = 1; i < stopIds.length; i += 1) {
      const index = indexByStop.get(stopIds[i]);
      if (index === undefined || index !== cursor + 1) {
        contiguous = false;
        break;
      }
      cursor = index;
    }

    if (contiguous) {
      const terminal = pattern.terminalStationId
        ? snapshot.stationsById.get(pattern.terminalStationId)
        : undefined;
      if (terminal) return terminal.name;
    }
  }
  return undefined;
};

interface LegAccumulator {
  kind: 'ride' | 'transfer';
  lineId?: string;
  stopIds: string[];
  stationIds: string[];
  seconds: number;
  distanceKm: number;
}

/**
 * Itinerary for one assigned shop, or null when its station is unreachable
 * from the origin (e.g. disconnected network) — the badge still renders from
 * the persisted `shop.transit.metro`, only the time/overlay is absent.
 */
export const buildShopItinerary = (
  snapshot: MetroSnapshot,
  dijkstra: MetroDijkstra,
  originDistanceKm: number,
  shopMetro: ShopMetro
): MetroShopItinerary | null => {
  const target = dijkstra.bestStopByStation.get(shopMetro.stationId);
  if (!target) return null;

  // Walk predecessors from the shop's best stop back to the origin station.
  const chain: MetroEdgeDoc[] = [];
  let cursor = target.stopId;
  for (;;) {
    const step = dijkstra.prev.get(cursor);
    if (!step) break;
    chain.push(step.edge);
    cursor = step.stopId;
  }
  chain.reverse();

  const legs: LegAccumulator[] = [];
  let rideSeconds = 0;
  let transferCount = 0;

  for (const edge of chain) {
    const last = legs[legs.length - 1];
    if (edge.kind === 'ride' && last?.kind === 'ride' && last.lineId === edge.lineId) {
      // Same line, contiguous by construction — extend the ride leg.
      last.stopIds.push(edge.to);
      last.stationIds.push(edge.toStationId);
      last.seconds += edge.seconds;
      last.distanceKm += edge.distanceKm ?? 0;
    } else if (edge.kind === 'ride') {
      legs.push({
        kind: 'ride',
        lineId: edge.lineId ?? undefined,
        stopIds: [edge.from, edge.to],
        stationIds: [edge.fromStationId, edge.toStationId],
        seconds: edge.seconds,
        distanceKm: edge.distanceKm ?? 0
      });
    } else {
      legs.push({
        kind: 'transfer',
        stopIds: [edge.from, edge.to],
        stationIds:
          edge.fromStationId === edge.toStationId
            ? [edge.fromStationId]
            : [edge.fromStationId, edge.toStationId],
        seconds: edge.seconds,
        distanceKm: edge.distanceKm ?? 0
      });
      transferCount += 1;
    }
    if (edge.kind === 'ride') rideSeconds += edge.seconds;
  }

  const responseLegs: MetroLegPlan[] = legs.map((leg) => {
    if (leg.kind === 'transfer') {
      return { kind: 'transfer', stationIds: leg.stationIds, seconds: leg.seconds };
    }
    const direction = leg.lineId ? findRideDirection(snapshot, leg.lineId, leg.stopIds) : undefined;
    return {
      kind: 'ride',
      ...(leg.lineId ? { lineId: leg.lineId } : {}),
      stationIds: leg.stationIds,
      seconds: leg.seconds,
      ...(leg.distanceKm > 0 ? { distanceKm: leg.distanceKm } : {}),
      ...(direction ? { direction } : {})
    };
  });

  return {
    totalSeconds: computeTotalSeconds(
      computeWalkSeconds(originDistanceKm),
      target.seconds,
      shopMetro.walkSeconds
    ),
    rideSeconds,
    transferCount,
    legs: responseLegs
  };
};

export interface MetroBlockInput {
  snapshot: MetroSnapshot;
  /** Origin snap result (already ≤ METRO_ORIGIN_MAX_KM). */
  origin: MetroSnapResult;
  /** Actual search origin, after any requested coordinate conversion. */
  originCoordinates: { lon: number; lat: number };
  /** Origin station's network, from `snapshot.networks`. */
  network: {
    id: string;
    name: string;
    names: { zh: string; en: string };
    cityRegionId: string;
  };
  /**
   * Shops to embed, each with its itinerary. Callers that already reconstructed
   * the itinerary (to decide whether the metro is worth taking) pass it here so
   * it is not rebuilt — the legs are identical either way.
   */
  assignedShops: Array<{ id: number | string; itinerary: MetroShopItinerary }>;
}

/**
 * Assemble the ready-to-serve `metro` block. Null when no shops were given
 * (the caller omits the block; badges keep working from the persisted
 * assignments).
 */
export const assembleMetroBlock = (input: MetroBlockInput): DiscoverMetroBlock | null => {
  const { snapshot, origin, network, assignedShops } = input;

  const lines: DiscoverMetroBlock['lines'] = {};
  const stations: DiscoverMetroBlock['stations'] = {};
  const shops: DiscoverMetroBlock['shops'] = {};

  stations[origin.station._id] = {
    name: origin.station.name,
    names: origin.station.names,
    lon: origin.station.lon,
    lat: origin.station.lat
  };

  for (const shop of assignedShops) {
    const itinerary = shop.itinerary;
    shops[String(shop.id)] = itinerary;

    for (const leg of itinerary.legs) {
      if (leg.lineId) {
        const line = snapshot.linesById.get(leg.lineId);
        if (line) {
          lines[line._id] = {
            id: line._id,
            name: line.name,
            names: line.names,
            color: line.color,
            shortName: line.shortName
          };
        }
      }
      for (const stationId of leg.stationIds) {
        const station = snapshot.stationsById.get(stationId);
        if (station) {
          stations[station._id] = {
            name: station.name,
            names: station.names,
            lon: station.lon,
            lat: station.lat
          };
        }
      }
    }
  }

  if (Object.keys(shops).length === 0) return null;

  return {
    network,
    origin: {
      stationId: origin.station._id,
      stationName: origin.station.name,
      names: origin.station.names,
      walkSeconds: computeWalkSeconds(origin.distanceKm),
      lon: input.originCoordinates.lon,
      lat: input.originCoordinates.lat
    },
    lines,
    stations,
    shops
  };
};

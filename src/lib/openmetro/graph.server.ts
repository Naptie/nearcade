/**
 * ── Metro Graph Server Utilities ───────────────────────────────────────────
 * Flat global station snapping and one Dijkstra over the stop-level adjacency
 * for travel-time isochrones.
 */
import { METRO_ORIGIN_MAX_KM } from '$lib/constants';
import { computeWalkSeconds } from '$lib/utils/travel';
import type { MetroEdgeDoc, MetroStationDoc } from './schemas';
import type { MetroSnapshot } from './snapshot.server';

/** Re-exported so routing code and the verify script keep one import path. */
export { computeWalkSeconds };

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Exported for the ranking phase: straight-line distance to a POI, mirroring
 * `$lib/utils.calculateDistance` (R = 6371) — kept local so the openmetro
 * modules stay importable outside SvelteKit.
 */
export { haversineKm as calculateDistanceKm };

export interface MetroSnapResult {
  station: MetroStationDoc;
  distanceKm: number;
}

/**
 * Nearest station in the flat list (all networks), or null beyond `maxKm`.
 * For shop assignments pass `METRO_ACCESS_MAX_KM`; for request origins pass
 * `METRO_ORIGIN_MAX_KM` (the default).
 */
export const snapToStation = (
  stations: MetroStationDoc[],
  lat: number,
  lng: number,
  maxKm: number = METRO_ORIGIN_MAX_KM
): MetroSnapResult | null => {
  let best: MetroSnapResult | null = null;
  for (const station of stations) {
    const distanceKm = haversineKm(lat, lng, station.lat, station.lon);
    if (!best || distanceKm < best.distanceKm) {
      best = { station, distanceKm };
    }
  }
  return best && best.distanceKm <= maxKm ? best : null;
};

export interface MetroDijkstra {
  originStationId: string;
  /** Best (min) seconds per reached stop. */
  distByStop: Map<string, number>;
  /** Cheapest stop per reached station, with its seconds. */
  bestStopByStation: Map<string, { stopId: string; seconds: number }>;
  /** Predecessor edge per reached stop (`edge.to === stopId`). */
  prev: Map<string, { stopId: string; edge: MetroEdgeDoc }>;
}

/**
 * One Dijkstra over the global stop-level adjacency (~1500 stops across all
 * networks — sub-millisecond). All platforms of the origin station start at 0
 * (entering the system once — no self-transfer penalty). Null when the origin
 * station has no routing stops.
 */
export const runMetroDijkstra = (
  snapshot: MetroSnapshot,
  originStationId: string
): MetroDijkstra | null => {
  const originStops = snapshot.stopsByStation.get(originStationId);
  if (!originStops || originStops.length === 0) return null;

  const distByStop = new Map<string, number>();
  const prev = new Map<string, { stopId: string; edge: MetroEdgeDoc }>();

  // Binary min-heap of [seconds, stopId].
  const heap: Array<[number, string]> = [];
  const swap = (i: number, j: number) => {
    [heap[i], heap[j]] = [heap[j], heap[i]];
  };
  const push = (seconds: number, stopId: string) => {
    heap.push([seconds, stopId]);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      swap(parent, i);
      i = parent;
    }
  };
  const pop = (): [number, string] | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left;
        if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right;
        if (smallest === i) break;
        swap(smallest, i);
        i = smallest;
      }
    }
    return top;
  };

  for (const stopId of originStops) {
    distByStop.set(stopId, 0);
    push(0, stopId);
  }

  for (;;) {
    const entry = pop();
    if (!entry) break;
    const [seconds, stopId] = entry;
    if (seconds > (distByStop.get(stopId) ?? Infinity)) continue;
    for (const edge of snapshot.adjacency.get(stopId) ?? []) {
      const next = seconds + edge.seconds;
      if (next < (distByStop.get(edge.to) ?? Infinity)) {
        distByStop.set(edge.to, next);
        prev.set(edge.to, { stopId, edge });
        push(next, edge.to);
      }
    }
  }

  const bestStopByStation = new Map<string, { stopId: string; seconds: number }>();
  for (const [stopId, seconds] of distByStop) {
    const stationId = snapshot.stopStation.get(stopId);
    if (!stationId) continue;
    const best = bestStopByStation.get(stationId);
    if (!best || seconds < best.seconds) {
      bestStopByStation.set(stationId, { stopId, seconds });
    }
  }

  return { originStationId, distByStop, bestStopByStation, prev };
};

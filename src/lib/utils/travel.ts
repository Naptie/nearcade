/**
 * ── Metro Travel-Time Model ────────────────────────────────────────────────
 * One place that defines how long a metro trip takes, so the server's sort
 * order and the browser's rendered itinerary can never disagree.
 *
 * This module deliberately does **not** estimate walk or ride times. A
 * straight-line distance cannot support a credible door-to-door time — the
 * street network detours around buildings, rivers and one-way systems, so the
 * number would be simultaneously wrong and authoritative-looking. Walking is
 * used only as a *baseline to compare against* (see `isMetroWorthwhile`); it
 * never becomes a per-shop result. A shop without a worthwhile metro trip is
 * shown exactly as it was before metro existed: distance only, no directions.
 *
 * Kept free of SvelteKit imports (`$env`, `$lib/db`) so it is usable from the
 * server endpoints, the graph/routing modules, and the browser client alike.
 */
import type { TransportMethod, TransportSearchResult } from '$lib/types';
import {
  METRO_ENTRY_OVERHEAD_SECONDS,
  METRO_EXIT_OVERHEAD_SECONDS,
  METRO_MIN_RIDE_STATIONS,
  METRO_WALK_DETOUR_FACTOR,
  METRO_WALK_SPEED_KMH
} from '$lib/constants';

/** A shop reachable faster by metro than by walking the straight line. */
export interface ShopTravelEstimate {
  /** Door-to-door metro seconds. */
  seconds: number;
  /** In-system seconds (travelled inside the network). */
  metroSeconds: number;
}

/**
 * Straight-line walk time in seconds (detour factor included).
 *
 * This is the **baseline** the metro trip must beat — not a displayed value.
 */
export const computeWalkSeconds = (distanceKm: number): number =>
  Math.round(((distanceKm * METRO_WALK_DETOUR_FACTOR) / METRO_WALK_SPEED_KMH) * 3600);

/** Total metro travel time = access walk + entry + in-system + exit + egress walk. */
export const computeMetroTripSeconds = (
  accessWalkSeconds: number,
  inSystemSeconds: number,
  egressWalkSeconds: number
): number =>
  accessWalkSeconds +
  METRO_ENTRY_OVERHEAD_SECONDS +
  inSystemSeconds +
  METRO_EXIT_OVERHEAD_SECONDS +
  egressWalkSeconds;

/** The metro itinerary facts a candidate shop contributes. */
export interface MetroItinerary {
  /** Door-to-door metro seconds (access walk, entry, ride, exit, egress walk). */
  seconds: number;
  /** In-system seconds (riding + transfers, between the two stations). */
  metroSeconds: number;
  /**
   * Distinct stations the ride passes through, in order. Entering and leaving
   * at the same station is a walk with extra steps, so a single-station
   * "itinerary" is not a metro trip.
   */
  rideStationIds: string[];
}

/**
 * Is the metro trip worth taking over simply walking the straight line?
 *
 * Two conditions, both necessary:
 *
 * 1. **Faster than the baseline.** The metro must beat walking the straight-line
 *    distance. Because a straight line understates the real walk, this is a
 *    conservative test — the metro has to win by enough to survive the detour
 *    the walk would actually take.
 * 2. **At least two stations.** A "trip" that enters and exits at one station
 *    is not using the network; it is a walk plus fare gates.
 *
 * There is no distance band: a shop 300 m from the origin can legitimately be
 * reached by metro if riding is genuinely faster, and a shop 8 km away should
 * stay a plain entry when no station is near it.
 */
export const isMetroWorthwhile = (input: {
  distanceKm: number;
  itinerary: MetroItinerary | null;
}): boolean => {
  const { distanceKm, itinerary } = input;
  if (!itinerary) return false;

  // Condition 2 — the ride must actually travel between stations.
  if (new Set(itinerary.rideStationIds).size < METRO_MIN_RIDE_STATIONS) return false;

  // Condition 1 — must beat walking the straight-line distance.
  const walkSeconds = computeWalkSeconds(distanceKm);
  return Number.isFinite(itinerary.seconds) && itinerary.seconds < walkSeconds;
};

/**
 * Build the travel estimate for a shop that passed `isMetroWorthwhile`.
 * Returns null when the shop has no worthwhile metro trip — the caller then
 * leaves the shop without a travel figure, exactly as before metro existed.
 */
export const estimateTravel = (input: {
  distanceKm: number;
  itinerary: MetroItinerary | null;
}): ShopTravelEstimate | null => {
  const { distanceKm, itinerary } = input;
  if (!itinerary || !isMetroWorthwhile({ distanceKm, itinerary })) return null;

  return { seconds: itinerary.seconds, metroSeconds: itinerary.metroSeconds };
};

/**
 * A rough door-to-door walk (or ride) time inferred purely from the
 * straight-line distance — the fallback shown for shops with no metro
 * advantage, so the travel column can display a time for every row.
 *
 * **This is an inference, not a measurement.** A straight line ignores the
 * street network, so treat it as an order-of-magnitude figure for ranking and
 * display, never as a promise. The metro estimate above is the only time we
 * can stand behind, which is why metro always wins when both exist.
 */
export const inferTravelSeconds = (distanceKm: number): number => computeWalkSeconds(distanceKm);

export const getTravelIcon = (
  method: TransportMethod,
  result?: TransportSearchResult,
  selectedRouteIndex = 0
): string => {
  if (method === 'walking') return 'fa-person-walking';
  if (method === 'riding') return 'fa-bicycle';
  if (method === 'driving') return 'fa-car';
  if (method !== 'transit') return 'fa-person-walking';

  if (result && typeof result === 'object' && 'plans' in result) {
    const segments = result.plans[selectedRouteIndex]?.segments;
    if (segments?.length) {
      const modes = new Set(segments.map((segment) => segment.transit_mode));
      modes.delete('WALK');
      if (modes.size === 0) return 'fa-person-walking';
      if (modes.size === 1) {
        if (modes.has('SUBWAY')) return 'fa-train-subway';
        if (modes.has('BUS')) return 'fa-bus';
        if (modes.has('METRO_RAIL')) return 'fa-train-tram';
        if (modes.has('RAILWAY')) return 'fa-train';
        if (modes.has('TAXI')) return 'fa-taxi';
      }
    }
  }

  return 'fa-bus-simple';
};

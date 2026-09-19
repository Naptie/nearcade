/**
 * ── Metro (openmetro) Browser Utilities ────────────────────────────────────
 * Everything the discover page needs to render openmetro itineraries from the
 * ready-to-serve `metro` block of the discover response. No routing happens
 * here — the server already computed every leg, station and line color.
 *
 * The only live openmetro traffic is the supplementary fare lookup (§3.5),
 * which is cached in memory for the session and fails silently.
 *
 * **Geometry conventions** mirror openmetro's own web frontend
 * (`packages/web`): official per-line colors for ride legs, a neutral dashed
 * style for walking legs, and the line's terminal station as the direction
 * label. Map-agnostic output is intentional — the discover page translates
 * these segments into AMap polylines, so nothing here depends on the maps SDK.
 */
import { env } from '$env/dynamic/public';
import { createClient, type ApiRoutePlan } from 'openmetro-client';
import { m } from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import {
  METRO_ENTRY_OVERHEAD_SECONDS,
  METRO_EXIT_OVERHEAD_SECONDS,
  METRO_WALK_SPEED_KMH
} from '$lib/constants';
import type { DiscoverMetroBlock, MetroShopItinerary, Shop, ShopMetro } from '$lib/types';
import type { Path, Segment, TransitPlan } from '$lib/types/amap';

/** Neutral color for legs that carry no official line color. */
const METRO_FALLBACK_COLOR = '#64748b';
/**
 * Walking legs (access, transfer, egress) are drawn dashed grey — openmetro's
 * own frontend uses the same neutral treatment so walks never read as a line.
 */
export const METRO_WALK_COLOR = '#6b7280';
export const METRO_WALK_DASH: [number, number] = [6, 3];

/** Fallback ride speed used only when a leg omits `distanceKm` (~35 km/h). */
const METRO_RIDE_SPEED_KMH = 35;

export type MetroOverlayKind = 'walk' | 'ride' | 'transfer';

/**
 * One drawable piece of an itinerary, map-agnostic. `path` is
 * `[longitude, latitude]` pairs.
 */
export interface MetroOverlaySegment {
  kind: MetroOverlayKind;
  path: [number, number][];
  /** Official line color for ride legs; null for walking legs. */
  color: string | null;
  dashed: boolean;
  weight: number;
  /** Ride legs only: `[fromStationId, toStationId]` of the clipped run. */
  stationIds?: string[];
}

/** Seconds → km using the same conservative walk model the server persists. */
const walkSecondsToKm = (seconds: number): number => (seconds / 3600) * METRO_WALK_SPEED_KMH;

const rideLegKm = (leg: { seconds: number; distanceKm?: number }): number =>
  leg.distanceKm ?? (leg.seconds / 3600) * METRO_RIDE_SPEED_KMH;

const toLngLat = (lon: number, lat: number): [number, number] => [lon, lat];

/** Itinerary for a shop, or null when the response carries none. */
export const getMetroItinerary = (
  block: DiscoverMetroBlock | undefined,
  shopId: Shop['id'] | string
): MetroShopItinerary | null => (block ? (block.shops[String(shopId)] ?? null) : null);

interface ResolvedRide {
  lineId?: string;
  lineName: string;
  color: string | null;
  path: [number, number][];
  stationIds: string[];
  seconds: number;
  km: number;
  direction?: string;
}

interface ResolvedWalk {
  path: [number, number][];
  seconds: number;
  km: number;
}

interface ResolvedGeometry {
  itinerary: MetroShopItinerary;
  /** Access walk: origin → origin station. */
  access: ResolvedWalk & { stationName: string };
  /** Egress walk: egress station → shop. */
  egress: ResolvedWalk;
  rides: ResolvedRide[];
  /** Transfer walks in travel order, each between two rides. */
  transfers: Array<ResolvedWalk & { stationName: string }>;
  /**
   * Itinerary in travel order — the same sequence `legs` describes, with
   * unknown stations dropped. Drives both the overlay and the synthetic plan,
   * so the two can never disagree.
   */
  orderedSteps: Array<
    | { kind: 'ride'; ride: ResolvedRide }
    | { kind: 'transfer'; transfer: ResolvedWalk & { stationName: string } }
  >;
  /** Full itinerary geometry in travel order. */
  fullPath: [number, number][];
  totalKm: number;
}

/**
 * Resolve every leg of a shop's itinerary into coordinates using only the
 * referenced-stations map from the response. Unknown ids are skipped
 * defensively (§6: stale assignments after a network update).
 */
const resolveGeometry = (
  shop: Shop,
  block: DiscoverMetroBlock,
  itinerary: MetroShopItinerary
): ResolvedGeometry | null => {
  const stationCoord = (stationId: string): [number, number] | null => {
    const station = block.stations[stationId];
    return station ? toLngLat(station.lon, station.lat) : null;
  };

  const originCoord = toLngLat(block.origin.lon, block.origin.lat);
  const originStationCoord = stationCoord(block.origin.stationId);
  if (!originStationCoord) return null;

  const shopCoord: [number, number] = [shop.location.coordinates[0], shop.location.coordinates[1]];

  const access = {
    path: [originCoord, originStationCoord] as [number, number][],
    seconds: block.origin.walkSeconds,
    km: walkSecondsToKm(block.origin.walkSeconds),
    stationName: getMetroLocalizedName(block.origin.names, block.origin.stationName, getLocale())
  };

  const rides: ResolvedRide[] = [];
  const transfers: Array<ResolvedWalk & { stationName: string }> = [];
  const orderedSteps: ResolvedGeometry['orderedSteps'] = [];
  const fullPath: [number, number][] = [...access.path];
  let totalKm = access.km;
  // Egress walk starts where the last ride ended; patched once rides exist.
  let egressFrom: [number, number] | null = null;

  const pushToFullPath = (coords: [number, number][]) => {
    for (const coord of coords) {
      const prev = fullPath[fullPath.length - 1];
      if (prev && prev[0] === coord[0] && prev[1] === coord[1]) continue;
      fullPath.push(coord);
    }
  };

  for (const leg of itinerary.legs) {
    if (leg.kind === 'transfer') {
      const stationId = leg.stationIds[0];
      const coord = stationId ? stationCoord(stationId) : null;
      if (!coord) continue;
      const stationName = stationId ? localizedStationName(block, stationId) : '';
      const transfer = {
        path: [coord, coord] as [number, number][],
        seconds: leg.seconds,
        km: walkSecondsToKm(leg.seconds),
        stationName
      };
      transfers.push(transfer);
      orderedSteps.push({ kind: 'transfer', transfer });
      totalKm += transfer.km;
      continue;
    }

    const coords: [number, number][] = [];
    const visited: string[] = [];
    for (const stationId of leg.stationIds) {
      const coord = stationCoord(stationId);
      if (!coord) continue;
      const last = coords[coords.length - 1];
      if (last && last[0] === coord[0] && last[1] === coord[1]) continue;
      coords.push(coord);
      visited.push(stationId);
    }
    if (coords.length < 2) continue;

    const line = leg.lineId ? block.lines[leg.lineId] : undefined;
    const km = rideLegKm(leg);
    const ride: ResolvedRide = {
      lineId: leg.lineId,
      lineName: line?.name ?? '',
      color: line?.color ?? (line ? METRO_FALLBACK_COLOR : null),
      path: coords,
      stationIds: visited,
      seconds: leg.seconds,
      km,
      direction: leg.direction
    };
    rides.push(ride);
    orderedSteps.push({ kind: 'ride', ride });
    totalKm += km;
    pushToFullPath(coords);
    egressFrom = coords[coords.length - 1];
  }

  const egress: ResolvedWalk = {
    path: [egressFrom ?? originStationCoord, shopCoord],
    seconds: shop.transit?.metro?.walkSeconds ?? 0,
    km: walkSecondsToKm(shop.transit?.metro?.walkSeconds ?? 0)
  };
  totalKm += egress.km;
  pushToFullPath(egress.path.slice(1));

  return { itinerary, access, egress, rides, transfers, orderedSteps, fullPath, totalKm };
};

/**
 * Map-agnostic overlay pieces for one shop: dashed access/transfer/egress walks
 * plus solid official-colored ride legs. Empty when the response has no
 * itinerary for the shop (badge-only shops).
 */
export const buildMetroOverlay = (
  shop: Shop,
  block: DiscoverMetroBlock | undefined
): MetroOverlaySegment[] => {
  const itinerary = getMetroItinerary(block, shop.id);
  if (!block || !itinerary) return [];

  const geometry = resolveGeometry(shop, block, itinerary);
  if (!geometry) return [];

  const segments: MetroOverlaySegment[] = [
    {
      kind: 'walk',
      path: geometry.access.path,
      color: null,
      dashed: true,
      weight: 5
    }
  ];

  // Follow the itinerary's own leg order (ride / transfer / ride …) so a
  // multi-ride journey draws in travel order rather than all rides then all
  // transfers. `orderedSteps` is the same sequence the synthetic plan uses.
  for (const step of geometry.orderedSteps) {
    if (step.kind === 'ride') {
      segments.push({
        kind: 'ride',
        path: step.ride.path,
        color: step.ride.color ?? METRO_FALLBACK_COLOR,
        dashed: false,
        weight: 8,
        stationIds: step.ride.stationIds
      });
      continue;
    }

    // Transfers happen inside one station: no geometry worth drawing, so the
    // dashed walk is only emitted when its endpoints actually differ.
    const [from, to] = step.transfer.path;
    if (from[0] === to[0] && from[1] === to[1]) continue;
    segments.push({
      kind: 'transfer',
      path: step.transfer.path,
      color: null,
      dashed: true,
      weight: 5
    });
  }

  segments.push({
    kind: 'walk',
    path: geometry.egress.path,
    color: null,
    dashed: true,
    weight: 5
  });

  return segments;
};

/** Total itinerary geometry in travel order (used for fit-view and highlight). */
export const buildMetroFullPath = (
  shop: Shop,
  block: DiscoverMetroBlock | undefined
): [number, number][] => {
  const itinerary = getMetroItinerary(block, shop.id);
  if (!block || !itinerary) return [];
  return resolveGeometry(shop, block, itinerary)?.fullPath ?? [];
};

/** AMap wants plain `{ lng, lat }` objects for `path` fields. */
const toAMapPath = (coords: [number, number][]): Path => coords.map(([lng, lat]) => ({ lng, lat }));

export const getMetroShopLines = (
  shop: Shop,
  block: DiscoverMetroBlock | undefined
): ShopMetro['lines'] => {
  const metro = shop.transit?.metro;
  if (!metro) return [];

  return metro.lines.map((line) => {
    if (block?.network.id === metro.networkId) return block.lines[line.id] ?? line;
    return line;
  });
};

const getMetroShopLine = (
  shop: Shop,
  block: DiscoverMetroBlock | undefined
): ShopMetro['lines'][number] | null => {
  const metro = shop.transit?.metro;
  if (!metro) return null;

  const itinerary = getMetroItinerary(block, shop.id);
  if (block && itinerary && metro.networkId === block.network.id) {
    for (let index = itinerary.legs.length - 1; index >= 0; index--) {
      const leg = itinerary.legs[index];
      if (
        leg.kind !== 'ride' ||
        !leg.lineId ||
        leg.stationIds[leg.stationIds.length - 1] !== metro.stationId
      )
        continue;

      return getMetroShopLines(shop, block).find((line) => line.id === leg.lineId) ?? null;
    }
  }
  return getMetroShopLines(shop, block)[0] ?? null;
};

export const getMetroShopColor = (
  shop: Shop,
  block: DiscoverMetroBlock | undefined
): string | null => getMetroShopLine(shop, block)?.color ?? null;

export const getMetroShopLineCode = (
  shop: Shop,
  block: DiscoverMetroBlock | undefined
): string | null => getMetroShopLine(shop, block)?.shortName ?? null;

/** Pick the higher-contrast foreground for an opaque OpenMetro hex line color. */
export const getMetroBadgeTextColor = (color: string | null): '#000000' | '#ffffff' => {
  const hex = color?.replace(/^#/, '') ?? '';
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) return '#ffffff';
  const expanded = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(expanded.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
};

/**
 * Localized display name for any openmetro entity (`names` is the API's
 * `ApiNames` contract: zh + en both mandatory). Mirrors openmetro's own
 * `localizedName`: desired locale first, then `en`, then the entity's
 * primary `name` (Chinese) as the last resort.
 */
export const getMetroLocalizedName = (
  names: { zh?: string; en?: string } | null | undefined,
  fallback: string,
  locale: string
): string => (locale === 'zh' ? names?.zh : undefined) || names?.en || names?.zh || fallback;

/**
 * Localized station name from the discover response's referenced-stations map
 * (ids are the defensive fallback for stale assignments, §6).
 */
export const localizedStationName = (block: DiscoverMetroBlock, stationId: string): string => {
  const station = block.stations[stationId];
  return station ? getMetroLocalizedName(station.names, station.name, getLocale()) : stationId;
};

/**
 * Synthetic AMap `TransitPlan` built entirely from the response, so the
 * existing (unmodified) `<Directions routeData>` renders metro itineraries.
 *
 * Segment order follows `orderedSteps`, i.e. the itinerary's own leg sequence
 * (ride / transfer / ride …) bracketed by the access and egress walks.
 *
 * `cost` stays at `fare ?? 0` — while it is 0 the panel shows the time stat,
 * and the live fare lookup (§3.5) re-renders it as the cost stat once known.
 */
export const buildMetroTransitPlan = (
  shop: Shop,
  block: DiscoverMetroBlock | undefined,
  fare: number | null = null
): TransitPlan | null => {
  const itinerary = getMetroItinerary(block, shop.id);
  if (!block || !itinerary) return null;

  const geometry = resolveGeometry(shop, block, itinerary);
  if (!geometry) return null;

  const stationName = (stationId: string) => localizedStationName(block, stationId);
  const stationLocation = (stationId: string, fallback: [number, number]): [number, number] => {
    const station = block.stations[stationId];
    return station ? toLngLat(station.lon, station.lat) : fallback;
  };

  const walkSegment = (walk: ResolvedWalk, instruction: string): Segment => ({
    time: walk.seconds,
    instruction,
    transit_mode: 'WALK',
    distance: Math.round(walk.km * 1000),
    transit: { path: toAMapPath(walk.path), steps: [] }
  });

  const segments: Segment[] = [
    walkSegment(geometry.access, m.walk_to_station({ station: geometry.access.stationName }))
  ];

  for (const [index, step] of geometry.orderedSteps.entries()) {
    if (step.kind === 'transfer') {
      segments.push(
        walkSegment(step.transfer, m.transfer_at({ station: step.transfer.stationName }))
      );
      continue;
    }

    const ride = step.ride;
    const onStationId = ride.stationIds[0];
    const offStationId = ride.stationIds[ride.stationIds.length - 1];
    const onName = stationName(onStationId);
    const offName = stationName(offStationId);
    const onLocation = stationLocation(onStationId, ride.path[0]);
    const offLocation = stationLocation(offStationId, ride.path[ride.path.length - 1]);

    const viaStops = ride.stationIds.slice(1, -1).map((stationId, index) => ({
      id: stationId,
      name: stationName(stationId),
      location: stationLocation(stationId, ride.path[index + 1])
    }));

    // "1号线(王府井--四惠)" flows through the existing formatTransitLineName:
    // the section header strips the bracket, the detail row renders
    // "1号线 (王府井 → 四惠)".
    const lineLabel = ride.direction
      ? `${ride.lineName}(${onName}--${ride.direction})`
      : ride.lineName;

    // The itinerary total includes the entry overhead (security + platform
    // wait) and the exit overhead (gates + wayfinding), but no leg carries
    // them — the panel's per-step times would then never add up to its own
    // total. The overheads belong to riding the metro, not to walking, so
    // they are folded into the first and last ride segments. This also keeps
    // a zero-metre walk segment from reading "0m · 4min" when the origin sits
    // exactly on a station.
    const entryOverhead = index === 0 ? METRO_ENTRY_OVERHEAD_SECONDS : 0;
    const exitOverhead =
      index === geometry.orderedSteps.length - 1 ? METRO_EXIT_OVERHEAD_SECONDS : 0;

    segments.push({
      time: ride.seconds + entryOverhead + exitOverhead,
      instruction: lineLabel,
      transit_mode: 'SUBWAY',
      distance: Math.round(ride.km * 1000),
      transit: {
        path: toAMapPath(ride.path),
        on_station: { id: onStationId, name: onName, location: onLocation },
        off_station: { id: offStationId, name: offName, location: offLocation },
        via_num: Math.max(0, ride.stationIds.length - 2),
        via_stops: viaStops,
        lines: [
          {
            id: ride.lineId ?? ride.lineName,
            name: lineLabel,
            type: 'SUBWAY',
            color: ride.color ?? METRO_FALLBACK_COLOR,
            stime: '',
            etime: ''
          }
        ]
      }
    });
  }

  segments.push(walkSegment(geometry.egress, m.walk_to_shop()));

  const walkingKm =
    geometry.access.km +
    geometry.egress.km +
    geometry.transfers.reduce((sum, transfer) => sum + transfer.km, 0);

  return {
    cost: fare ?? 0,
    time: itinerary.totalSeconds,
    nightLine: false,
    segments,
    transit_distance: Math.round(geometry.rides.reduce((sum, ride) => sum + ride.km, 0) * 1000),
    railway_distance: 0,
    walking_distance: Math.round(walkingKm * 1000),
    taxi_distance: 0,
    distance: Math.round(geometry.totalKm * 1000),
    path: toAMapPath(geometry.fullPath)
  };
};

/** Synthetic AMap response wrapper, so `<Directions>` receives its usual shape. */
export const buildMetroRouteData = (
  shop: Shop,
  block: DiscoverMetroBlock | undefined,
  fare: number | null = null
): { plans: TransitPlan[] } | null => {
  const plan = buildMetroTransitPlan(shop, block, fare);
  return plan ? { plans: [plan] } : null;
};

// ── Live fare enrichment (§3.5) ─────────────────────────────────────────────

const getApiBase = (): string =>
  env.PUBLIC_OPENMETRO_API_BASE?.trim() || 'https://openmetro.phi.zone';

let client: ReturnType<typeof createClient> | null = null;
const getClient = () => (client ??= createClient(getApiBase()));

/** Session-scoped fare cache keyed `networkId:fromStation:toStation`. */
const fareCache = new Map<string, number | null>();
const fareInFlight = new Map<string, Promise<number | null>>();

/**
 * Fare for the in-system part of a shop's itinerary, or null when openmetro
 * publishes none / the request fails. Never throws and never persists.
 */
export const fetchMetroFare = async (
  block: DiscoverMetroBlock | undefined,
  shopMetro: ShopMetro | undefined
): Promise<number | null> => {
  if (!block || !shopMetro || shopMetro.networkId !== block.network.id) return null;
  if (shopMetro.stationId === block.origin.stationId) return null;

  const key = `${block.network.id}:${block.origin.stationId}:${shopMetro.stationId}`;
  if (fareCache.has(key)) return fareCache.get(key)!;

  const existing = fareInFlight.get(key);
  if (existing) return existing;

  const request = (async (): Promise<number | null> => {
    try {
      const { data, error } = await getClient()
        .api.networks({ id: block.network.id })
        .route.get({
          query: { from: block.origin.stationId, to: shopMetro.stationId, weight: 'time' }
        });
      const plan = data as ApiRoutePlan | null;
      if (error || !plan) return null;
      return typeof plan.fare === 'number' ? plan.fare : null;
    } catch {
      // Silent by design (§6): the panel simply keeps showing the time stat.
      return null;
    } finally {
      fareInFlight.delete(key);
    }
  })();

  fareInFlight.set(key, request);
  const fare = await request;
  fareCache.set(key, fare);
  return fare;
};

/**
 * Provider-free routing types for the unified-geo directions proxy
 * (`/api/geo/directions`), the openmetro metro itineraries, and the
 * `<Directions>` panel that renders both.
 *
 * A `RouteResult` is one candidate route; `TransportSearchResult` is the full
 * response for a shop+mode (`{ routes: [...] }`), mirroring the unified-geo
 * `DirectionsResult[]` shape; a route is a list of `RouteLeg`s.
 */

export type LegKind = 'walk' | 'ride' | 'drive' | 'bus' | 'subway' | 'rail' | 'ferry';

export interface RouteStep {
  instruction?: string;
  distanceMeters?: number;
  durationSeconds?: number;
}

/**
 * One drawable, listable stretch of a route — a walk, a ride on one line, a
 * run along one road — with its own turn-by-turn `steps`.
 */
export interface RouteLeg {
  kind: LegKind;
  /** Road name for walk/ride/drive legs; line name for transit legs. */
  name?: string;
  /** Line brand color; absent falls back to the leg kind's own color. */
  color?: string | null;
  distanceMeters: number;
  durationSeconds: number;
  /** `[longitude, latitude]` pairs, in the route's datum. */
  geometry: [number, number][];
  steps: RouteStep[];
  /** Transit-only: board / alight stations and the stops between them. */
  stations?: { on?: string; off?: string; via?: string[]; stopCount?: number };
}

export interface RouteResult {
  mode: 'driving' | 'walking' | 'cycling' | 'transit';
  distanceMeters: number;
  durationSeconds: number;
  /** Full-route geometry, `[longitude, latitude]` pairs. */
  geometry: [number, number][];
  legs: RouteLeg[];
  /** Datum of the geometry ('WGS84' | 'GCJ02'). */
  coordinateSystem: 'WGS84' | 'GCJ02';
  /** Transit-only: operator line names/colors per segment, travel order. */
  lines?: Array<{ name: string; color?: string | null }>;
  /** Transit-only: fare when the routing service reports one. */
  cost?: number;
}

export type TransportSearchResult = { routes: RouteResult[] } | string | undefined;

export interface CachedRouteData {
  routeData: TransportSearchResult;
  selectedRouteIndex: number;
}

export interface DirectionsState {
  isOpen: boolean;
  shopId: string | null;
  selectedRouteIndex: number;
}

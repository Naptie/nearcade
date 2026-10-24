/**
 * Provider-free routing types for the unified-geo directions proxy
 * (`/api/geo/directions`), the openmetro metro itineraries, and the
 * `<Directions>` panel that renders both.
 *
 * A `RouteResult` is one candidate route; `TransportSearchResult` is the full
 * response for a shop+mode (`{ routes: [...] }`), mirroring the unified-geo
 * `DirectionsResult[]` shape.
 */

/** One drawable route: a total plus per-segment geometry. */
export interface RouteSegment {
  instruction?: string;
  distanceMeters?: number;
  durationSeconds?: number;
  /** `[longitude, latitude]` pairs, in the route's datum. */
  geometry: [number, number][];
  /** Segment paint color for map rendering; null falls back to the mode color. */
  color?: string | null;
  /** Draw the segment dashed (walking legs). */
  dashed?: boolean;
  /** Transit-only: station names for the panel (board / alight / via). */
  stations?: { on?: string; off?: string; via?: string[] };
}

export interface RouteResult {
  mode: 'driving' | 'walking' | 'cycling' | 'transit';
  distanceMeters: number;
  durationSeconds: number;
  /** Full-route geometry, `[longitude, latitude]` pairs. */
  geometry: [number, number][];
  segments: RouteSegment[];
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

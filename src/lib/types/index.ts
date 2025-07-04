import type { RADIUS_OPTIONS } from '../constants';

interface Location {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface Shop {
  _id: string;
  id: number;
  name: string;
  province_code: string;
  city_code: string;
  location: Location;
  games: Game[];
}

export interface Game {
  id: number;
  name: string;
  version: string;
  quantity: number;
  cost: number;
}

export interface Campus {
  name: string | null;
  longitude: number;
  latitude: number;
}

export interface University {
  _id?: string;
  name: string;
  majorCategory: string;
  natureOfRunning: string;
  schoolType: string;
  is985: boolean;
  is211: boolean;
  isDoubleFirstClass: boolean;
  province: string;
  city: string;
  affiliation: string;
  campuses: Campus[];
}

export interface AMapContext {
  amap: typeof AMap | undefined;
  ready: boolean;
  error: string | null;
}

export interface DonationContext {
  openModal: () => void;
  visitCount: () => number;
}

export interface UniversityRankingData {
  universityId: string;
  universityName: string;
  campusName: string | null;
  fullName: string;
  province: string;
  city: string;
  affiliation: string;
  schoolType: string;
  is985: boolean;
  is211: boolean;
  isDoubleFirstClass: boolean;
  longitude: number;
  latitude: number;
  rankings: RankingMetrics[];
}

export interface RankingMetrics {
  radius: number; // in kilometers
  shopCount: number;
  totalMachines: number;
  areaDensity: number; // machines per km²
  gameSpecificMachines: {
    name: string;
    quantity: number;
  }[];
}

export interface UniversityRankingCache {
  createdAt: Date;
  expiresAt: Date;
  data: UniversityRankingData[];
}

export type SortCriteria =
  | 'shops'
  | 'machines'
  | 'density'
  | 'maimai_dx'
  | 'chunithm'
  | 'taiko_no_tatsujin'
  | 'sound_voltex'
  | 'wacca';

export type TransportMethod = undefined | 'transit' | 'walking' | 'riding' | 'driving';

export type RadiusFilter = (typeof RADIUS_OPTIONS)[number];

export * from './amap';
import type { TransportSearchResult } from './amap';

// Extended types for route guidance
export interface CachedRouteData {
  fullRouteResult: TransportSearchResult;
  selectedRouteIndex: number;
  timestamp: number;
  expiresAt: number;
}

export interface RouteGuidanceState {
  isOpen: boolean;
  shopId: number | null;
  selectedRouteIndex: number;
  allRoutes: RouteOption[];
}

export interface RouteOption {
  index: number;
  time: number;
  distance: number;
  summary: string;
  polyline?: AMap.Polyline;
}

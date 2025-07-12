import type { RADIUS_OPTIONS } from '../constants';

export interface Location {
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
  id: string;
  name: string | null;
  province: string;
  city: string;
  district: string;
  address: string;
  location: Location;
}

export interface University {
  _id?: string;
  id: string;
  name: string;
  type: string;
  majorCategory: string | null;
  natureOfRunning: string | null;
  affiliation: string;
  is985: boolean | null;
  is211: boolean | null;
  isDoubleFirstClass: boolean | null;
  campuses: Campus[];
}

export interface AMapContext {
  amap: typeof AMap | undefined;
  error: string | null;
}

export interface UniversityRankingData {
  id: string;
  universityName: string;
  campusName: string | null;
  fullName: string;
  type: string;
  majorCategory: string | null;
  natureOfRunning: string | null;
  affiliation: string;
  is985: boolean | null;
  is211: boolean | null;
  isDoubleFirstClass: boolean | null;
  province: string;
  city: string;
  district: string;
  address: string;
  location: Location;
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
  routeData: TransportSearchResult;
  selectedRouteIndex: number;
}

export interface RouteGuidanceState {
  isOpen: boolean;
  shopId: number | null;
  selectedRouteIndex: number;
}

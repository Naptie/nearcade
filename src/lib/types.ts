import type { RADIUS_OPTIONS } from './constants';

export interface Shop {
  _id: string;
  id: number;
  name: string;
  province_code: string;
  city_code: string;
  location: {
    latitude: number;
    longitude: number;
  };
  games: Game[];
}

export interface Game {
  id: number;
  name: string;
  version: string;
  quantity: number;
  coin: number;
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

export type RadiusFilter = (typeof RADIUS_OPTIONS)[number];

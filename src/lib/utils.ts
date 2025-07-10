import { m } from './paraglide/messages';
import { Database } from './db';
import type { Shop, Game, TransportMethod, TransportSearchResult, CachedRouteData } from './types';
import { ROUTE_CACHE_STORE } from './constants';

export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const isDarkMode = (): boolean => {
  const darkModeMediaQuery = window?.matchMedia('(prefers-color-scheme: dark)');
  return darkModeMediaQuery?.matches;
};

export const parseRelativeTime = (date: Date, locale: string) => {
  const now = new Date();
  const diffInSeconds = Math.floor((date.getTime() - now.getTime()) / 1000);

  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 },
    { label: 'second', seconds: 1 }
  ];

  for (const interval of intervals) {
    const count = Math.floor(Math.abs(diffInSeconds) / interval.seconds);

    if (count > 0) {
      return new Intl.RelativeTimeFormat(locale, {
        localeMatcher: 'best fit',
        numeric: 'auto',
        style: 'long'
      }).format(diffInSeconds > 0 ? count : -count, interval.label as Intl.RelativeTimeFormatUnit);
    }
  }

  return new Intl.RelativeTimeFormat(locale, {
    localeMatcher: 'best fit',
    numeric: 'auto',
    style: 'long'
  }).format(0, 'second');
};
export const getGameMachineCount = (shops: Shop[], gameId: number): number => {
  return shops.reduce((total, shop) => {
    const game = shop.games?.find((g: Game) => g.id === gameId);
    return total + (game?.quantity || 0);
  }, 0);
};

export const calculateAreaDensity = (machineCount: number, radiusKm: number): number => {
  const areaKm2 = Math.PI * Math.pow(radiusKm, 2);
  return machineCount / areaKm2;
};

export const formatDistance = (distance: number, precision = 0): string => {
  if (distance === Infinity) return m.unknown();
  return distance >= 1
    ? m.dist_km({
        km: distance.toFixed(precision)
      })
    : m.dist_m({
        m: (distance * 1000).toFixed(Math.max(0, precision - 3))
      });
};

export const formatTime = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined) return m.unknown();
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (minutes === 60) {
    return m.time_length({
      hours: (hours + 1).toString(),
      minutes: '0'
    });
  }

  return m.time_length({
    hours: hours.toString(),
    minutes: minutes.toString()
  });
};

export const generateRouteCacheKey = (
  originLat: number,
  originLng: number,
  shopId: number,
  transportMethod: TransportMethod
): string => {
  const lat = Number(originLat.toFixed(4));
  const lng = Number(originLng.toFixed(4));
  return `${transportMethod}-${shopId}-${lat}-${lng}`;
};

export const getCachedRouteData = async (cacheKey: string): Promise<CachedRouteData | null> => {
  if (typeof window === 'undefined') return null;
  try {
    const cachedRoute = await Database.get<CachedRouteData>(ROUTE_CACHE_STORE, cacheKey);
    return cachedRoute;
  } catch (error) {
    console.error('Error reading route cache:', error);
    return null;
  }
};

export const setCachedRouteData = async (
  cacheKey: string,
  routeData: TransportSearchResult,
  selectedRouteIndex: number = 0
): Promise<void> => {
  if (typeof window === 'undefined') return;
  const cachedRoute: CachedRouteData = {
    routeData: routeData,
    selectedRouteIndex
  };
  try {
    await Database.set(ROUTE_CACHE_STORE, cacheKey, cachedRoute);
  } catch (error) {
    console.error('Error writing route cache:', error);
  }
};

export const clearRouteCache = async (n: number = 0): Promise<void> => {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    if (n > 0) {
      await Database.clearEarliest(ROUTE_CACHE_STORE, n);
    }
    const expiredCleared = await Database.clearExpired(ROUTE_CACHE_STORE, now);
    if (expiredCleared > 0 || n > 0) {
      console.log(`Cleared ${expiredCleared + n} route cache entries`);
    }
  } catch (error) {
    console.error('Error clearing route cache:', error);
  }
};

export const toAMapLngLat = (point: number[] | { lng: number; lat: number }): AMap.LngLat => {
  if (Array.isArray(point)) {
    return new AMap.LngLat(point[0], point[1]);
  } else if ('lng' in point && 'lat' in point) {
    return new AMap.LngLat(point.lng, point.lat);
  } else {
    throw new Error('Invalid point format for AMap conversion');
  }
};

export const convertPath = (points: (number[] | { lng: number; lat: number })[]): AMap.LngLat[] => {
  return points.map((point) => toAMapLngLat(point));
};

export const removeRecursiveBrackets = (input: string) => {
  let result = input;
  let hasChanges = true;

  while (hasChanges) {
    hasChanges = false;
    const newResult = result.replace(/[(（][^()（）]*[)）]/g, '');
    if (newResult !== result) {
      result = newResult;
      hasChanges = true;
    }
  }

  return result.trim();
};

export const areValidCoordinates = (
  latParam: string,
  lngParam: string
):
  | { isValid: boolean; latitude: number; longitude: number }
  | { isValid: false; latitude: null; longitude: null } => {
  const lat = parseFloat(latParam);
  const lng = parseFloat(lngParam);
  if (isNaN(lat) || !isFinite(lat) || isNaN(lng) || !isFinite(lng)) {
    return { isValid: false, latitude: null, longitude: null };
  }

  // Latitude: -90 to +90, Longitude: -180 to +180
  return {
    isValid: lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180,
    latitude: lat,
    longitude: lng
  };
};

export const formatRegionLabel = (
  location?: { province: string; city: string; district?: string } | null,
  withDistrict = true,
  divider = ' · '
): string => {
  if (!location) return m.unknown();

  const { province, city, district } = location;

  if (withDistrict && district) {
    return `${formatRegionLabel(location, false, divider)}${divider}${district}`;
  }
  if (city && city !== province) {
    return `${province}${divider}${city}`;
  }
  return province;
};

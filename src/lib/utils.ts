import { m } from './paraglide/messages';
import type { Shop, Game, TransportMethod, TransportSearchResult, CachedRouteData } from './types';

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

export const areCoordinatesApproxEqual = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): boolean => {
  const tolerance = 0.025;
  return Math.abs(lat1 - lat2) < tolerance && Math.abs(lng1 - lng2) < tolerance;
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
  return m.km({
    km: distance.toFixed(precision)
  });
};

export const formatTime = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined) return m.unknown();
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return m.time_length({
    hours: hours.toString(),
    minutes: minutes.toString()
  });
};

// Route caching utilities
const ROUTE_CACHE_PREFIX = 'nearcade_route_';
const ROUTE_CACHE_EXPIRY_HOURS = 24;

export const generateRouteCacheKey = (
  originLat: number,
  originLng: number,
  shopId: number,
  transportMethod: TransportMethod
): string => {
  // Round coordinates to 3 decimal places for caching consistency (~111m precision)
  const lat = Math.round(originLat * 1000) / 1000;
  const lng = Math.round(originLng * 1000) / 1000;
  return `${ROUTE_CACHE_PREFIX}${lat}_${lng}_${shopId}_${transportMethod}`;
};

export const getCachedRouteData = (cacheKey: string): CachedRouteData | null => {
  if (typeof window === 'undefined') return null;
  
  try {
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;
    
    const cachedRoute: CachedRouteData = JSON.parse(cached);
    
    // Check if cache has expired
    if (Date.now() > cachedRoute.expiresAt) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    
    return cachedRoute;
  } catch (error) {
    console.error('Error reading route cache:', error);
    return null;
  }
};

export const setCachedRouteData = (
  cacheKey: string,
  routeData: TransportSearchResult,
  selectedRouteIndex: number = 0
): void => {
  if (typeof window === 'undefined') return;
  
  try {
    const cachedRoute: CachedRouteData = {
      fullRouteResult: routeData,
      selectedRouteIndex,
      timestamp: Date.now(),
      expiresAt: Date.now() + ROUTE_CACHE_EXPIRY_HOURS * 60 * 60 * 1000
    };
    
    localStorage.setItem(cacheKey, JSON.stringify(cachedRoute));
  } catch (error) {
    console.error('Error setting route cache:', error);
  }
};

export const clearExpiredRouteCache = (): void => {
  if (typeof window === 'undefined') return;
  
  try {
    const keys = Object.keys(localStorage).filter(key => 
      key.startsWith(ROUTE_CACHE_PREFIX)
    );
    
    const now = Date.now();
    let clearedCount = 0;      keys.forEach(key => {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const cachedRoute: CachedRouteData = JSON.parse(cached);
            if (now > cachedRoute.expiresAt) {
              localStorage.removeItem(key);
              clearedCount++;
            }
          }
        } catch {
          // Remove corrupted cache entries
          localStorage.removeItem(key);
          clearedCount++;
        }
      });
    
    if (clearedCount > 0) {
      console.log(`Cleared ${clearedCount} expired route cache entries`);
    }
  } catch (error) {
    console.error('Error clearing expired route cache:', error);
  }
};

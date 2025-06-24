import type { Shop, Game } from './types';

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

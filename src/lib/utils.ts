import { m } from './paraglide/messages';
import { Database } from './db';
import type { Collection, Document } from 'mongodb';
import type {
  Shop,
  Game,
  TransportMethod,
  TransportSearchResult,
  CachedRouteData,
  UniversityMember,
  ClubMember,
  ClubMemberWithUser,
  UniversityMemberWithUser,
  UserType
} from './types';
import { ROUTE_CACHE_STORE } from './constants';
import { env } from '$env/dynamic/public';
import { base } from '$app/paths';
import type { MongoClient } from 'mongodb';
import { page } from '$app/state';
import type { User } from '@auth/sveltekit';

/**
 * Generates a valid and unique username based on input name
 */
export async function generateValidUsername(
  inputName: string | null | undefined,
  fallbackId: string,
  usersCollection: Collection<Document>
): Promise<string> {
  // Helper function to check if name is valid (A-Za-z0-9_-)
  const isValidCharacterSet = (name: string): boolean => {
    return /^[A-Za-z0-9_-]+$/.test(name);
  };

  // Helper function to extract legal characters
  const extractLegalCharacters = (name: string): string => {
    return name.replace(/[^A-Za-z0-9_-]/g, '');
  };

  // Helper function to check if username is unique
  const isUnique = async (username: string): Promise<boolean> => {
    const existing = await usersCollection.findOne({ name: username });
    return !existing;
  };

  // If inputName is provided and valid
  if (inputName && isValidCharacterSet(inputName)) {
    if (await isUnique(inputName)) {
      return inputName;
    }
  }

  // Extract legal characters from inputName
  if (inputName) {
    const legalName = extractLegalCharacters(inputName);
    if (legalName && (await isUnique(legalName))) {
      return legalName;
    }
  }

  // Fall back to using the ID
  return fallbackId;
}

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

export const toPath = (path: string) => {
  path = ((p) => (p.startsWith('/') ? p : `/${p}`))(path.trim());
  return `${env.PUBLIC_API_BASE || `${page.url.origin}${base}`}${path}`;
};

// Permission utilities
export const checkUniversityPermission = async (
  userId: string,
  universityId: string,
  client: MongoClient
): Promise<{ canEdit: boolean; canManage: boolean; role?: string }> => {
  // Site admins always have full permission
  const db = client.db();
  const usersCollection = db.collection('users');
  const user = await usersCollection.findOne({ id: userId });

  if (user?.userType === 'site_admin') {
    return { canEdit: true, canManage: true, role: 'admin' };
  }

  // Check university membership
  const universityMembersCollection = db.collection('university_members');
  const membership = await universityMembersCollection.findOne({
    userId,
    universityId
  });

  if (!membership) {
    return { canEdit: false, canManage: false };
  }

  const isAdmin = membership.memberType === 'admin';
  const isModerator = membership.memberType === 'moderator';

  return {
    canEdit: isAdmin || isModerator,
    canManage: isAdmin,
    role: membership.memberType
  };
};

export const checkClubPermission = async (
  userId: string,
  clubId: string,
  client: MongoClient
): Promise<{ canEdit: boolean; canManage: boolean; role?: string }> => {
  // Site admins always have full permission
  const db = client.db();
  const usersCollection = db.collection('users');
  const user = await usersCollection.findOne({ id: userId });

  if (user?.userType === 'site_admin') {
    return { canEdit: true, canManage: true, role: 'site_admin' };
  }

  // Check club membership
  const clubMembersCollection = db.collection('club_members');
  const membership = await clubMembersCollection.findOne({
    userId,
    clubId
  });

  if (!membership) {
    return { canEdit: false, canManage: false };
  }

  const isAdmin = membership.memberType === 'admin';
  const isModerator = membership.memberType === 'moderator';

  return {
    canEdit: isAdmin || isModerator,
    canManage: isAdmin,
    role: membership.memberType
  };
};

export const updateUserType = async (userId: string, client: MongoClient): Promise<void> => {
  const db = client.db();
  const universityMembersCollection = db.collection('university_members');
  const clubMembersCollection = db.collection('club_members');
  const usersCollection = db.collection<User>('users');

  // Get all memberships for this user
  const universityMemberships = await universityMembersCollection
    .find<UniversityMember>({ userId })
    .toArray();
  const clubMemberships = await clubMembersCollection.find<ClubMember>({ userId }).toArray();

  // Determine highest privilege
  let newUserType: UserType | undefined = undefined;

  // Check for admin roles
  const isSiteAdmin = (await usersCollection.findOne({ id: userId }))?.userType === 'site_admin';
  const isUniversityAdmin = universityMemberships.some((m) => m.memberType === 'admin');
  const isClubAdmin = clubMemberships.some((m) => m.memberType === 'admin');

  if (isSiteAdmin) {
    newUserType = 'site_admin';
  } else if (isUniversityAdmin) {
    newUserType = 'school_admin';
  } else if (isClubAdmin) {
    newUserType = 'club_admin';
  } else {
    // Check for moderator roles
    const isUniversityModerator = universityMemberships.some((m) => m.memberType === 'moderator');
    const isClubModerator = clubMemberships.some((m) => m.memberType === 'moderator');

    if (isUniversityModerator) {
      newUserType = 'school_moderator';
    } else if (isClubModerator) {
      newUserType = 'club_moderator';
    } else {
      // Check for member roles
      if (universityMemberships.some((m) => m.memberType === 'student')) {
        newUserType = 'student';
      }
    }
  }

  // Update user type
  await usersCollection.updateOne({ id: userId }, { $set: { userType: newUserType } });
};

/**
 * Joins university member data with user data
 */
export async function getUniversityMembersWithUserData(
  universityId: string,
  mongoClient: MongoClient,
  options: { limit?: number; sort?: Record<string, 1 | -1> } = {}
) {
  const db = mongoClient.db();
  const membersCollection = db.collection<UniversityMember>('university_members');
  const usersCollection = db.collection<Document>('users');

  // Get membership data
  let query = membersCollection.find({ universityId });

  if (options.sort) {
    query = query.sort(options.sort);
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const membershipData = await query.toArray();

  // Get user IDs from membership data
  const userIds = membershipData.map((member) => member.userId);

  // Fetch user data for all members
  const users = await usersCollection.find({ id: { $in: userIds } }).toArray();

  // Create a map for quick user lookup
  const userMap = new Map(users.map((user) => [user.id, user]));

  // Combine membership data with user data
  return membershipData
    .map((member) => {
      const user = userMap.get(member.userId);
      if (!user) {
        return {
          ...member,
          _id: member._id?.toString(),
          user: null
        };
      }
      return {
        ...member,
        _id: member._id?.toString(),
        user: {
          ...user,
          _id: user._id?.toString()
        }
      } as UniversityMemberWithUser;
    })
    .filter((member) => member.user !== null); // Filter out members whose users don't exist
}

/**
 * Joins club member data with user data
 */
export async function getClubMembersWithUserData(
  clubId: string,
  mongoClient: MongoClient,
  options: { limit?: number; sort?: Record<string, 1 | -1> } = {}
) {
  const db = mongoClient.db();
  const membersCollection = db.collection('club_members');
  const usersCollection = db.collection('users');

  // Get membership data
  let query = membersCollection.find({ clubId });

  if (options.sort) {
    query = query.sort(options.sort);
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const membershipData = await query.toArray();

  // Get user IDs from membership data
  const userIds = membershipData.map((member) => member.userId);

  // Fetch user data for all members
  const users = await usersCollection.find({ id: { $in: userIds } }).toArray();

  // Create a map for quick user lookup
  const userMap = new Map(users.map((user) => [user.id, user]));

  // Combine membership data with user data
  return membershipData
    .map((member) => {
      const user = userMap.get(member.userId);
      if (!user) {
        return {
          ...member,
          _id: member._id?.toString(),
          user: null
        };
      }
      return {
        ...member,
        _id: member._id?.toString(),
        user: {
          ...user,
          _id: user._id?.toString()
        }
      } as ClubMemberWithUser;
    })
    .filter((member) => member.user !== null); // Filter out members whose users don't exist
}

export const isAdminOrModerator = (user?: { userType?: string }): boolean => {
  return (
    user?.userType === 'site_admin' ||
    user?.userType === 'school_admin' ||
    user?.userType === 'club_admin' ||
    user?.userType === 'school_moderator' ||
    user?.userType === 'club_moderator'
  );
};

export const getUserTypeLabel = (role: string | undefined) => {
  switch (role) {
    case 'site_admin':
      return m.site_admin();
    case 'school_admin':
      return m.school_admin();
    case 'school_moderator':
      return m.school_moderator();
    case 'club_admin':
      return m.club_admin();
    case 'club_moderator':
      return m.club_moderator();
    case 'student':
      return m.student();
    default:
      return m.regular_user();
  }
};

export const getUserTypeBadgeClass = (userType: string | undefined) => {
  switch (userType) {
    case 'site_admin':
      return 'badge-error';
    case 'school_admin':
      return 'badge-warning';
    case 'school_moderator':
      return 'badge-info';
    case 'club_admin':
      return 'badge-success';
    case 'club_moderator':
      return 'badge-accent';
    case 'student':
      return 'badge-neutral';
    default:
      return 'badge-soft';
  }
};

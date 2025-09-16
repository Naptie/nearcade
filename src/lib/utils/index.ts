import { m } from '$lib/paraglide/messages';
import { Database } from '$lib/db/index.client';
import { GAMES, ShopSource } from '$lib/constants';
import type { Collection, ObjectId, MongoClient } from 'mongodb';
import {
  type Shop,
  type Game,
  type Location,
  type TransportMethod,
  type TransportSearchResult,
  type CachedRouteData,
  type UniversityMember,
  type ClubMember,
  type ClubMemberWithUser,
  type UniversityMemberWithUser,
  type UserType,
  type Club,
  type University,
  PostWritability,
  PostReadability
} from '$lib/types';
import { ROUTE_CACHE_STORE } from '$lib/constants';
import type { User } from '@auth/sveltekit';
import { customAlphabet, nanoid } from 'nanoid';
import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import tzlookup from '@photostructure/tz-lookup';
import { getTimezoneOffset } from 'date-fns-tz';

export const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const postId = () => {
  return customAlphabet(alphabet, 14)();
};

export const commentId = () => {
  return customAlphabet(alphabet, 18)();
};

/**
 * Generates a valid and unique username based on input name
 */
export const generateValidUsername = async (
  inputName: string | null | undefined,
  userId: string | ObjectId | undefined,
  usersCollection: Collection<User>
): Promise<string> => {
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
    const existing = await usersCollection.findOne({
      name: username,
      _id: { $ne: userId }
    });
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
  return userId?.toString() || nanoid();
};

export const calculateDistance = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
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

export const getGameName = (identifier?: number | string): string | undefined => {
  const game = GAMES.find((g) =>
    typeof identifier === 'number' ? g.id === identifier : g.key === identifier
  );
  return game ? m[game.key]() : identifier?.toString();
};

export const getGameMachineCount = (shops: Shop[], titleId: number): number => {
  return shops.reduce((total, shop) => {
    const game = shop.games?.find((g: Game) => g.titleId === titleId);
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

export const formatDuration = (seconds: number | null | undefined): string => {
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
  shopId: string,
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

// Permission utilities
export const checkUniversityPermission = async (
  user: User,
  university: University | string,
  client: MongoClient
): Promise<{
  canEdit: boolean;
  canManage: boolean;
  canJoin: 0 | 1 | 2;
  role?: string;
  verificationEmail?: string;
  verifiedAt?: Date;
}> => {
  // Site admins always have full permission
  const db = client.db();

  if (typeof university === 'string') {
    const universityDoc = await db
      .collection<University>('universities')
      .findOne({ $or: [{ id: university }, { slug: university }] });
    if (!universityDoc) {
      throw new Error(`University with ID ${university} not found`);
    }
    university = universityDoc;
  }

  const eligibleForVerification = !!university.website;
  const isSiteAdmin = user?.userType === 'site_admin';

  // Check university membership
  const universityMembersCollection = db.collection<UniversityMember>('university_members');
  const membership = await universityMembersCollection.findOne({
    userId: user.id,
    universityId: university.id
  });

  if (!membership) {
    return {
      canEdit: isSiteAdmin,
      canManage: isSiteAdmin,
      canJoin: eligibleForVerification ? 2 : 0
    };
  }

  const isAdmin = isSiteAdmin || membership.memberType === 'admin';
  const isModerator = membership.memberType === 'moderator';

  return {
    canEdit: isAdmin || isModerator,
    canManage: isAdmin,
    canJoin: eligibleForVerification ? 1 : 0,
    role: isSiteAdmin ? 'admin' : membership.memberType,
    verificationEmail: membership.verificationEmail,
    verifiedAt: membership.verifiedAt
  };
};

export const checkClubPermission = async (
  user: User,
  club: Club | string,
  client: MongoClient,
  ignoreAcceptJoinRequestsSetting: boolean = false
): Promise<{ canEdit: boolean; canManage: boolean; canJoin: 0 | 1 | 2; role?: string }> => {
  const db = client.db();
  const clubMembersCollection = db.collection('club_members');
  const universityMembersCollection = db.collection('university_members');
  const joinRequestsCollection = db.collection('join_requests');

  const isSiteAdmin = user?.userType === 'site_admin';

  if (typeof club === 'string') {
    const clubDoc = await db.collection<Club>('clubs').findOne({ id: club });
    if (!clubDoc) {
      throw new Error(`Club with ID ${club} not found`);
    }
    club = clubDoc;
  }

  // Check club membership
  const membership = await clubMembersCollection.findOne({
    userId: user.id,
    clubId: club.id
  });

  let canJoin: 0 | 1 | 2 = 0;

  if (!membership && (ignoreAcceptJoinRequestsSetting || club?.acceptJoinRequests)) {
    // Check if user is a member of the club's university
    const universityMembership = await universityMembersCollection.findOne({
      universityId: club.universityId,
      userId: user.id
    });

    if (universityMembership) {
      // Check for existing join request
      const existingJoinRequest = await joinRequestsCollection.findOne({
        type: 'club',
        targetId: club.id,
        userId: user.id,
        status: 'pending'
      });
      canJoin = existingJoinRequest ? 1 : 2;
    }
  }

  if (!membership) {
    return {
      canEdit: isSiteAdmin,
      canManage: isSiteAdmin,
      role: isSiteAdmin ? 'admin' : undefined,
      canJoin
    };
  }

  const isAdmin = isSiteAdmin || membership.memberType === 'admin';
  const isModerator = membership.memberType === 'moderator';

  return {
    canEdit: isAdmin || isModerator,
    canManage: isAdmin,
    canJoin: 0, // already a member
    role: isSiteAdmin ? 'admin' : membership.memberType
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
export const getUniversityMembersWithUserData = async (
  universityId: string,
  mongoClient: MongoClient,
  options: {
    limit?: number;
    sort?: Record<string, 1 | -1>;
    filter?: Record<string, unknown>;
    userFilter?: Record<string, unknown>;
    userSort?: Record<string, 1 | -1>;
  } = {}
) => {
  const db = mongoClient.db();
  const membersCollection = db.collection<UniversityMember>('university_members');

  // Build filter for university_members
  const memberFilter = { universityId, ...(options.filter || {}) };

  // Aggregation pipeline
  const pipeline = [
    { $match: memberFilter },
    ...(options.sort ? [{ $sort: options.sort }] : []),
    ...(options.limit ? [{ $limit: options.limit }] : []),
    {
      $project: {
        verificationEmail: 0
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: 'id',
        as: 'user'
      }
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
    ...(options.userFilter
      ? [
          {
            $match: Object.entries(options.userFilter).reduce(
              (acc, [k, v]) => ({ ...acc, [`user.${k}`]: v }),
              {}
            )
          }
        ]
      : []),
    ...(options.userSort
      ? [
          {
            $sort: Object.entries(options.userSort).reduce(
              (acc, [k, v]) => ({ ...acc, [`user.${k}`]: v }),
              {}
            )
          }
        ]
      : [])
  ];

  const results = (await membersCollection
    .aggregate(pipeline)
    .toArray()) as UniversityMemberWithUser[];

  // Convert to plain objects and type
  return toPlainArray(results);
};

/**
 * Joins club member data with user data
 */
export const getClubMembersWithUserData = async (
  clubId: string,
  mongoClient: MongoClient,
  options: {
    limit?: number;
    sort?: Record<string, 1 | -1>;
    filter?: Record<string, unknown>;
    userFilter?: Record<string, unknown>;
    userSort?: Record<string, 1 | -1>;
  } = {}
) => {
  const db = mongoClient.db();
  const membersCollection = db.collection<ClubMember>('club_members');

  // Build filter for club_members
  const memberFilter = { clubId, ...(options.filter || {}) };

  // Aggregation pipeline
  const pipeline = [
    { $match: memberFilter },
    ...(options.sort ? [{ $sort: options.sort }] : []),
    ...(options.limit ? [{ $limit: options.limit }] : []),
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: 'id',
        as: 'user'
      }
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
    ...(options.userFilter
      ? [
          {
            $match: Object.entries(options.userFilter).reduce(
              (acc, [k, v]) => ({ ...acc, [`user.${k}`]: v }),
              {}
            )
          }
        ]
      : []),
    ...(options.userSort
      ? [
          {
            $sort: Object.entries(options.userSort).reduce(
              (acc, [k, v]) => ({ ...acc, [`user.${k}`]: v }),
              {}
            )
          }
        ]
      : [])
  ];

  const results = (await membersCollection.aggregate(pipeline).toArray()) as ClubMemberWithUser[];

  // Convert to plain objects and type
  return toPlainArray(results);
};

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

export const getDisplayName = (user?: { displayName?: string | null; name?: string | null }) => {
  return !user
    ? m.unknown_user()
    : user.displayName || (user.name ? `@${user.name}` : m.anonymous_user());
};

export const toPlainObject = <T extends { _id?: string | ObjectId } | null>(
  doc: T
): T extends null ? null : Omit<T, '_id'> & { _id: string } => {
  if (doc === null) return null as T extends null ? null : Omit<T, '_id'> & { _id: string };

  const plainify = (value: unknown): unknown => {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(plainify);
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] =
          (key === '_id' && val) || val instanceof Date ? val.toString() : plainify(val);
      }
      return result;
    }
    return value;
  };

  return plainify(doc) as T extends null ? null : Omit<T, '_id'> & { _id: string };
};

export const toPlainArray = <T extends { _id?: string | ObjectId } | null>(docs: T[]) => {
  return docs.map(toPlainObject);
};

export const formatDate = (date?: Date | string | null): string => {
  if (!date) return m.unknown();
  if (typeof date === 'string') {
    date = new Date(date);
  }
  return date.toLocaleDateString();
};

export const formatDateTime = (date?: Date | string | null): string => {
  if (!date) return m.unknown();
  if (typeof date === 'string') {
    date = new Date(date);
  }
  return date.toLocaleString();
};

export const formatTime = (time?: string | Date): string => {
  if (!time) return m.unknown();
  return new Date(time).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const canWriteUnivPosts = (
  userPermissions: { role?: string; canEdit: boolean },
  university: University
) => {
  const postWritability = university.postWritability ?? PostWritability.UNIV_MEMBERS;
  if (postWritability === PostWritability.PUBLIC) return true;
  let canWritePosts = false;

  if (postWritability === PostWritability.UNIV_MEMBERS) {
    canWritePosts = userPermissions.canEdit || !!userPermissions.role;
  } else if (postWritability === PostWritability.ADMINS_AND_MODS) {
    canWritePosts = userPermissions.canEdit;
  }

  return canWritePosts;
};

export const canWriteClubPosts = async (
  userPermissions: { role?: string; canEdit: boolean; canJoin: 0 | 1 | 2 },
  club: Club,
  user: User | undefined,
  client: MongoClient
) => {
  if (!user) return false;
  const postWritability = club.postWritability ?? PostWritability.CLUB_MEMBERS;
  if (postWritability === PostWritability.PUBLIC) return true;
  let canWritePosts = false;

  if (postWritability === PostWritability.UNIV_MEMBERS) {
    canWritePosts =
      !!userPermissions.role ||
      userPermissions.canJoin > 0 ||
      !!(await checkUniversityPermission(user, club.universityId, client)).role;
  } else if (postWritability === PostWritability.CLUB_MEMBERS) {
    canWritePosts = userPermissions.canEdit || !!userPermissions.role;
  } else if (postWritability === PostWritability.ADMINS_AND_MODS) {
    canWritePosts = userPermissions.canEdit;
  }

  return canWritePosts;
};

/**
 * Validates if a user can set a specific readability level for a post
 * Regular users cannot set readability more open than the organization's postReadability setting
 * Site admins and organization admins/mods can set any level
 */
export const validatePostReadability = (
  requestedReadability: PostReadability,
  organizationReadability: PostReadability,
  userPermissions: { canEdit: boolean; role?: string },
  userType?: string | null
): boolean => {
  // Site admins can set any readability level
  if (userType === 'site_admin') {
    return true;
  }

  // Organization admins and moderators can set any level within their org
  if (userPermissions.canEdit) {
    return true;
  }

  // Regular users cannot set readability more open (lower value) than org setting
  return requestedReadability >= organizationReadability;
};

/**
 * Gets the default readability level for a new post based on organization settings
 */
export const getDefaultPostReadability = (
  organizationReadability?: PostReadability
): PostReadability =>
  organizationReadability !== undefined ? organizationReadability : PostReadability.PUBLIC;
/**
 * Checks if a user can read a post based on its readability setting
 */
export const canReadPost = async (
  postReadability: PostReadability,
  post: { universityId?: string; clubId?: string },
  user: User | undefined,
  client: MongoClient
): Promise<boolean> => {
  // PUBLIC posts can be read by anyone
  if (postReadability === PostReadability.PUBLIC) {
    return true;
  }

  // If no user, can't read protected posts
  if (!user?.id) {
    return false;
  }

  // For UNIV_MEMBERS readability
  if (postReadability === PostReadability.UNIV_MEMBERS) {
    if (post.universityId) {
      // Check if user is university member
      const permissions = await checkUniversityPermission(user, post.universityId, client);
      return !!permissions.role;
    } else if (post.clubId) {
      // For club posts with UNIV_MEMBERS readability, check university membership
      const db = client.db();
      const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
      if (club) {
        const permissions = await checkUniversityPermission(user, club.universityId, client);
        return !!permissions.role;
      }
    }
    return false;
  }

  // For CLUB_MEMBERS readability
  if (postReadability === PostReadability.CLUB_MEMBERS) {
    if (post.clubId) {
      // Check if user is club member
      const permissions = await checkClubPermission(user, post.clubId, client);
      return !!permissions.role;
    }
    return false;
  }

  return false;
};

export const isStandalone = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches;
};

/**
 * Builds a page title with proper ordering for PWA standalone mode
 * In standalone mode: returns parts in original reverse order (C - B - A)
 * In browser mode: returns parts in reverse order with app name (C - B - A - {appName})
 */
export const pageTitle = (...parts: string[]): string => {
  const filteredParts = parts.filter(Boolean); // Remove empty strings

  if (isStandalone()) {
    return [...filteredParts].reverse().join(' - ');
  } else {
    return `${filteredParts.join(' - ')} - ${m.app_name()}`;
  }
};

export const adaptiveNewTab = () => (isStandalone() ? '_self' : '_blank');

const processor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize)
  .use(rehypeStringify);

export const sanitizeHTML = async (input: string) => {
  if (!input) return '';
  const sanitized = String(await processor.process(input));
  return sanitized.replace(/<br>(?:\r?\n)*<br>/g, '<br>');
};

export const formatHourLiteral = (hourNum: number) => {
  const total = Number(hourNum % 24) || 0;
  let hour = Math.floor(total);
  let minutes = Math.round((total - hour) * 60);

  if (minutes === 60) {
    minutes = 0;
    hour = (hour + 1) % 24;
  }

  const hh = String((hour + 24) % 24).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${hh}:${mm}`;
};

/**
 * Formats a shop's general address array into a readable string
 */
export const formatShopAddress = (shop: Shop, detailed = false): string => {
  const addressParts: string[] = [];

  if (shop.address?.general) {
    const seen = new Set<string>();
    for (const part of shop.address.general) {
      if (!part) continue;
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        addressParts.push(trimmed);
      }
    }
  }

  const reverse = shop.source === ShopSource.ZIV;

  return addressParts.length > 0
    ? (reverse
        ? (detailed ? shop.address.detailed + '\n' : '') + addressParts.toReversed().join(', ')
        : addressParts.join(' · ') + (detailed ? '\n' + shop.address.detailed : '')
      ).trim()
    : '';
};

export const getShopSourceUrl = (shop: { id: number; source: ShopSource }): string =>
  `${
    shop.source === ShopSource.ZIV
      ? 'https://zenius-i-vanisher.com/v5.2/arcade.php?id='
      : 'https://map.bemanicn.com/shop/'
  }${shop.id}`;

/**
 * Determines timezone based on given coordinates
 */
export const getShopTimezone = (location: Location): string => {
  const [longitude, latitude] = location.coordinates;

  try {
    const timezone = tzlookup(latitude, longitude);
    if (timezone) return timezone;
  } catch (error) {
    console.error('Failed to lookup timezone:', error);
  }

  return 'Asia/Shanghai';
};

export const getCurrentTimeByLocation = (location: Location) => {
  const timezone = getShopTimezone(location);
  const offsetMs = getTimezoneOffset(timezone);
  const offsetHours = offsetMs / (1000 * 60 * 60);

  const now = new Date();
  const nowMs = now.getTime();

  // Determine the local date components by shifting now by the offset
  const nowShifted = new Date(nowMs + offsetMs);
  return { nowShifted, offsetHours };
};

/**
 * Calculate the next occurrence of the specified hour in the location's local time.
 * If that hour today has already passed, returns tomorrow at that hour.
 */
export const getNextTimeAtHour = (location: Location, hours: number[], basisHour: number) => {
  [basisHour, ...hours] = [basisHour, ...hours].map((hour) => Number(hour) || 0);
  const { nowShifted, offsetHours } = getCurrentTimeByLocation(location);

  const year = nowShifted.getUTCFullYear();
  const month = nowShifted.getUTCMonth();
  const date = nowShifted.getUTCDate();
  const minutes = basisHour % 1 === 0 ? 0 : Math.round((basisHour % 1) * 60);

  let targetUtcMs = Date.UTC(year, month, date, basisHour - offsetHours, minutes, 0, 0);

  // If that target time is not in the future (i.e. already passed or equal to now), move to next day
  if (targetUtcMs <= new Date().getTime()) {
    targetUtcMs = Date.UTC(year, month, date + 1, basisHour - offsetHours, minutes, 0, 0);
  }

  return {
    hours: hours.map((hour) => new Date(targetUtcMs + (hour - basisHour) * 3600 * 1000)),
    hour: new Date(targetUtcMs)
  };
};

/**
 * Get the opening hours for a shop
 * @param shop The shop to get opening hours for
 * @returns An object containing the opening and closing times
 */
export const getShopOpeningHours = (shop: Shop) => {
  const { nowShifted, offsetHours } = getCurrentTimeByLocation(shop.location);
  const openingHours =
    shop.openingHours.length === 1
      ? shop.openingHours[0]
      : (shop.openingHours[nowShifted.getDay()] ?? shop.openingHours[0]);
  const {
    hours: [open, close]
  } = getNextTimeAtHour(shop.location, openingHours, openingHours[1]);

  return {
    open,
    close,
    offsetHours: offsetHours,
    openLocal: formatHourLiteral(openingHours[0] ?? 0),
    closeLocal: formatHourLiteral(openingHours[1] ?? 0)
  };
};

export const getMyLocation = (): Promise<{ latitude: number; longitude: number }> =>
  new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(m.location_not_supported());
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      (error) => {
        let msg = m.location_unknown_error();
        switch (error?.code) {
          case 1: // PERMISSION_DENIED
            msg = m.location_permission_denied();
            break;
          case 2: // POSITION_UNAVAILABLE
            msg = m.location_unavailable();
            break;
          case 3: // TIMEOUT
            msg = m.location_timeout();
            break;
        }
        console.error('Geolocation error:', error);
        reject(msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  });

/**
 * Convert GPS coordinates to AMap coordinates when AMap is available
 */
export const convertCoordinates = (
  location: { latitude: number; longitude: number },
  amap?: typeof AMap
) => {
  if (amap && location.latitude !== undefined && location.longitude !== undefined) {
    return new Promise<typeof location>((resolve, reject) => {
      amap.convertFrom(
        [location.longitude, location.latitude],
        'gps',
        (status: string, response: { info: string; locations: { lat: number; lng: number }[] }) => {
          if (status === 'complete' && response.info === 'ok') {
            const result = response.locations[0];
            location.latitude = result.lat;
            location.longitude = result.lng;
            resolve(location);
          } else {
            console.error('AMap conversion failed:', status, response);
            reject(new Error('AMap conversion failed'));
          }
        }
      );
    });
  } else {
    console.warn('AMap not available or location not set, skipping conversion');
    return Promise.resolve(location);
  }
};

export const aggregateGames = (shop: Pick<Shop, 'games'>) => {
  const gameMap: Record<number, (typeof shop.games)[0]> = {};
  for (const g of shop.games) {
    const existing = gameMap[g.titleId];
    if (existing) {
      existing.quantity += g.quantity;
    } else {
      gameMap[g.titleId] = { ...g };
    }
  }
  return Object.values(gameMap);
};

export const protect = <T extends User | undefined>(user: T): T => {
  if (!user) return user;
  const propertiesToRemove = [
    'emailVerified',
    'notificationReadAt',
    'isActivityPublic',
    'isEmailPublic',
    'isFootprintPublic',
    'isFrequentingArcadePublic',
    'isStarredArcadePublic',
    'isUniversityPublic',
    'notificationTypes',
    'fcmTokenUpdatedAt',
    'fcmTokens',
    'autoDiscovery',
    'apiTokens'
  ];
  for (const prop of propertiesToRemove) {
    if (prop in user) {
      delete (user as never)[prop];
    }
  }
  if (user.isEmailPublic !== true) {
    delete user.email;
  }
  if (user.isFrequentingArcadePublic === false) {
    delete user.frequentingArcades;
  }
  if (user.isStarredArcadePublic === false) {
    delete user.starredArcades;
  }
  return user;
};

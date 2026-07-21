import type { ObjectId } from 'mongodb';
import type {
  RADIUS_OPTIONS,
  LIMIT_OPTIONS,
  GAME_TITLES,
  RANKING_RADIUS_OPTIONS
} from '../constants';
import type { TransportSearchResult } from './amap';
import type { PublicUser } from '$lib/auth/types';
import { z } from 'zod';
import { activitySchema } from '$lib/schemas/users';
import { commentSchema, commentVoteSchema } from '$lib/schemas/comments';
import { imageAssetSchema } from '$lib/schemas/images';
import type {
  campusSchema,
  clubMemberSchema,
  clubSchema,
  organizationChangelogEntrySchema,
  universityMemberSchema,
  universitySchema
} from '$lib/schemas/organizations';
import type { postSchema, postVoteSchema, postWithAuthorSchema } from '$lib/schemas/posts';
import type {
  gameSchema,
  shopDeleteRequestSchema,
  shopDeleteRequestVoteSchema,
  shopPhotoSchema,
  shopSchema
} from '$lib/schemas/shops';
import { shopChangelogActionSchema, shopChangelogEntrySchema } from '$lib/schemas/shops';

export interface Location {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface OpeningHourTime {
  hour: number;
  minute: number;
}

export type Shop = z.infer<typeof shopSchema>;

export type Game = z.infer<typeof gameSchema>;

export type Campus = z.infer<typeof campusSchema>;

export type University = z.infer<typeof universitySchema>;

export interface UniversityRankingResponse {
  data: UniversityRankingData[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  cached: boolean;
  cacheTime: Date;
  stale: boolean;
  calculating: boolean;
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
  district: string | null;
  address: string;
  location: Location;
  rankings: RankingMetrics[];
}

export interface RankingMetrics {
  radius: number; // in kilometers
  shopCount: number;
  totalMachines: number;
  areaDensity: number | null; // machines per km² (null when region area is unavailable)
  machinesPerCapita: number | null; // machines per 10,000 people; null when population is unavailable
  gameSpecificMachines: {
    name: string;
    quantity: number;
  }[];
}

export interface RankingsTableItem {
  id: string;
  rankings: RankingMetrics[];
}

export type RegionLevel = 'country' | 'province' | 'city' | 'county';
export interface RegionRankingData {
  id: string; // region ID from globe-cn hierarchy
  level: RegionLevel;
  name: string;
  country: string | null; // country region ID (not name)
  province: string | null; // province region ID
  city: string | null; // city region ID
  county: string | null; // county region ID
  /** Full region hierarchy (root → self) with multilingual names, populated by API. */
  regionChain?: { id: string; name: Record<string, string> }[];
  location: Location;
  area: number | null; // km² from region document
  population: number | null; // from region document
  shopCount: number;
  totalMachines: number;
  areaDensity: number | null; // machines per km² (null when region area is unavailable)
  machinesPerCapita: number | null; // machines per 10,000 people; null when population is unavailable
  gameSpecificMachines: { name: string; quantity: number }[];
}

export interface RegionRankingResponse {
  data: RegionRankingData[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  cached: boolean;
  cacheTime: string;
  stale: boolean;
  calculating?: boolean;
}

export interface RegionRankingCache {
  createdAt: Date;
  expiresAt: Date;
  data: RegionRankingData[];
}

export type SortCriteria =
  'shops' | 'machines' | 'density' | 'per_capita' | (typeof GAME_TITLES)[number]['key'];

export type TransportMethod = undefined | 'transit' | 'walking' | 'riding' | 'driving';

export type RadiusFilter = (typeof RADIUS_OPTIONS)[number];

export type RankingRadiusFilter = (typeof RANKING_RADIUS_OPTIONS)[number];

export type LimitFilter = (typeof LIMIT_OPTIONS)[number];

// Post permission enums
export enum PostReadability {
  PUBLIC = 0, // Anyone can read
  UNIV_MEMBERS = 1, // Only university members can read
  CLUB_MEMBERS = 2 // Only club members can read
}

export enum PostWritability {
  PUBLIC = 0, // Anyone can write
  UNIV_MEMBERS = 1, // All university members can write
  CLUB_MEMBERS = 2, // Only club members can write
  ADMINS_AND_MODS = 3 // Only admins and moderators can write
}

// User types and roles
export type UserType =
  | 'developer'
  | 'student'
  | 'school_moderator'
  | 'school_admin'
  | 'club_admin'
  | 'club_moderator'
  | 'site_admin';

export type NotificationType =
  | 'COMMENTS'
  | 'REPLIES'
  | 'POST_VOTES'
  | 'COMMENT_VOTES'
  | 'JOIN_REQUESTS'
  | 'SHOP_DELETE_REQUESTS';

export type Club = z.infer<typeof clubSchema>;

export type ClubMember = z.infer<typeof clubMemberSchema>;

// Composite type with user data joined
export interface ClubMemberWithUser extends ClubMember {
  user: PublicUser | undefined;
}

export interface InviteLink {
  _id?: string | ObjectId;
  id: string;
  code: string; // Unique invite code
  type: 'university' | 'club';
  targetId: string; // University ID or Club ID
  createdBy: string; // User ID of creator
  title?: string | null; // Display title for the invite
  description?: string | null;
  // Usage limits
  maxUses?: number | null; // null means unlimited
  currentUses: number;
  expiresAt?: Date | null; // null means no expiration
  // Settings
  requireApproval: boolean; // Require admin approval after using invite
  // Status
  isActive: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export type UniversityMember = z.infer<typeof universityMemberSchema>;

// Composite type with user data joined
export interface UniversityMemberWithUser extends Omit<UniversityMember, 'verificationEmail'> {
  user: PublicUser | undefined;
}

export type ShopDeleteRequest = z.infer<typeof shopDeleteRequestSchema>;

export type ShopDeleteRequestVoteType = 'favor' | 'against';

export type ShopDeleteRequestVote = z.infer<typeof shopDeleteRequestVoteSchema>;

export interface ShopDeleteRequestVoteSummary {
  favorVotes: number;
  againstVotes: number;
  userVote?: ShopDeleteRequestVoteType | null;
}

export type ImageStorageProvider = 's3' | 'leancloud';

export type ImageAsset = z.infer<typeof imageAssetSchema>;

export type ShopPhoto = z.infer<typeof shopPhotoSchema>;

export type ShopChangelogAction = z.infer<typeof shopChangelogActionSchema>;

export type ShopChangelogEntry = z.infer<typeof shopChangelogEntrySchema>;

export type ShopChangelogEntryWithUser = ShopChangelogEntry;

export interface JoinRequest {
  _id?: string | ObjectId;
  id: string;
  type: 'university' | 'club';
  targetId: string; // University ID or Club ID
  userId: string;
  requestMessage?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
  reviewedAt?: Date | null;
  reviewedBy?: string | null; // User ID of reviewer
  reviewNote?: string | null;
}

// Composite type with user data joined
export interface JoinRequestWithUser extends JoinRequest {
  user: PublicUser | undefined;
  reviewer?: PublicUser;
}

export type ChangelogEntry = z.infer<typeof organizationChangelogEntrySchema>;

export interface ChangelogEntryWithUser extends ChangelogEntry {
  user: {
    id: string;
    name: string | null;
    displayName?: string | null;
    image: string | null;
  };
}

// Posts feature types
export type Post = z.infer<typeof postSchema>;

export type PostWithAuthor = z.infer<typeof postWithAuthorSchema>;

export type PostVote = z.infer<typeof postVoteSchema>;

export type Comment = z.infer<typeof commentSchema>;

// Composite type with author data joined
export interface CommentWithAuthorAndVote extends Comment {
  author: PublicUser | undefined;
  vote?: CommentVote;
  authorDeleteRequestVote?: ShopDeleteRequestVote | null;
  resolvedImages?: ImageAsset[];
}

export type CommentVote = z.infer<typeof commentVoteSchema>;

// Activity types for recent activity feature
export type Activity = z.infer<typeof activitySchema>;

// Notification types for active notification system
export interface Notification {
  _id?: string | ObjectId;
  id: string;
  type:
    | 'COMMENTS'
    | 'REPLIES'
    | 'POST_VOTES'
    | 'COMMENT_VOTES'
    | 'JOIN_REQUESTS'
    | 'SHOP_DELETE_REQUESTS';
  actorUserId: string;
  actorName: string;
  actorDisplayName?: string;
  actorImage?: string;
  targetUserId: string;
  createdAt: Date;
  readAt?: Date | null;
  content?: string;

  // Content details
  postId?: string;
  postTitle?: string;
  commentId?: string;
  voteType?: 'upvote' | 'downvote';
  shopId?: number;

  // Join request details
  joinRequestId?: string;
  joinRequestStatus?: 'approved' | 'rejected';
  joinRequestType?: 'university' | 'club';

  // Shop delete request details
  shopDeleteRequestId?: string;
  shopDeleteRequestStatus?: 'approved' | 'rejected';
  shopDeleteRequestType?: 'shop' | 'photo';
  shopName?: string;

  // Navigation
  universityId?: string;
  clubId?: string;
  universityName?: string;
  clubName?: string;
}

export type AttendanceData = Array<{
  userId?: string;
  user?: PublicUser;
  attendedAt: string;
  plannedLeaveAt: string;
  gameId: number;
}>;

export type AttendanceReport = Array<{
  gameId: number;
  currentAttendances?: number;
  reportedBy: string;
  reporter?: PublicUser;
  reportedAt: string;
  comment: string | null;
}>;

// Interface for attendance records in MongoDB
export interface AttendanceRecord {
  _id?: string;
  userId: string;
  games: { gameId: number; name: string; version: string }[];
  attendedAt: Date;
  leftAt: Date;
  shopId: number;
}

export interface AttendanceReportRecord {
  _id?: string | ObjectId;
  shopId: number;
  games: { gameId: number; name: string; version: string; currentAttendances: number }[];
  comment: string | null;
  reportedBy: string; // User ID
  reportedAt: Date;
}

// Extended types for directions
export interface CachedRouteData {
  routeData: TransportSearchResult;
  selectedRouteIndex: number;
}

export interface DirectionsState {
  isOpen: boolean;
  shopId: string | null;
  selectedRouteIndex: number;
}

export interface WindowMessage {
  type: 'NAVIGATE' | 'INVALIDATE';
  payload?: string;
}

// Extended Shop type with attendance data
export interface ShopWithAttendance extends Shop {
  totalAttendance?: number;
  currentReportedAttendance?: {
    reportedAt: string;
    reportedBy: PublicUser;
    comment: string | null;
  } | null;
  isInAttendance?: boolean;
}

// Kiosk machine for queue management
export interface Machine {
  _id?: string | ObjectId;
  id: string;
  name: string;
  shopId: number;
  ownerId?: string; // User ID of the owner assigned to this machine
  serialNumber: string; // Auto-generated, used for activation
  apiSecret?: string; // Auto-generated upon activation
  isActivated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Queue status for players
export type QueueStatus = 'playing' | 'queued' | 'deferred';

// Queue member (player slot)
export interface QueueMember {
  slotIndex: string;
  userId: string | null;
}

// Queue position (can have multiple players for multi-seat games)
export interface QueuePosition {
  machineName: string;
  position: number;
  isPublic: boolean;
  status: QueueStatus;
  members: QueueMember[];
}

// Queue record for a specific game in a shop
export interface QueueRecord {
  _id?: string | ObjectId;
  shopId: number;
  games: { gameId: number; queue: QueuePosition[] }[];
  updatedAt: Date;
  updatedBy: string;
}

// Attendance registration token stored in Redis
export interface AttendanceRegistration {
  shopId: string;
  machineId: string;
  slotIndex: string;
  expiresAt: string;
  userId?: string;
}

export interface ParsedShopOpeningHours {
  open: Date;
  close: Date;
  openTolerated: Date;
  closeTolerated: Date;
  offsetHours: number;
  openLocal: string;
  closeLocal: string;
}

export interface GlobeShopGameSummary {
  titleId: number;
  name: string;
  quantity: number;
}

export interface GlobeShop {
  id: number;
  name: string;
  address: {
    general: string[];
    region?: string[] | { id: string; name: Record<string, string> }[];
  };
  openingHours: Shop['openingHours'];
  location: Shop['location'];
  aggregatedGames: GlobeShopGameSummary[];
  currentAttendance: number;
  density: number;
}

export interface GlobeShopWithExtras extends GlobeShop {
  openingHoursParsed?: ParsedShopOpeningHours;
}

// Shop with computed attendance and opening-hours data, used on the globe views.
export interface ShopWithExtras extends Shop {
  attendances: { gameId: number; total: number }[];
  openingHoursParsed?: ParsedShopOpeningHours;
  currentAttendance: number;
  density: number;
}

export * from './amap';

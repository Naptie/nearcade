import type { ObjectId } from 'mongodb';
import type { RADIUS_OPTIONS, GAME_TITLES } from '../constants';
import type { TransportSearchResult } from './amap';
import type { User } from '$lib/auth/types';

export interface Location {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface OpeningHourTime {
  hour: number;
  minute: number;
}

export interface Shop {
  _id: string;
  id: number;
  name: string;
  comment: string;
  address: {
    general: string[];
    detailed: string;
  };
  openingHours: [openTime: OpeningHourTime, closeTime: OpeningHourTime][];
  location: Location;
  games: Game[];
  isClaimed?: boolean;
  createdAt?: Date;
  updatedAt: Date;
}

export interface Game {
  gameId: number;
  titleId: number;
  name: string;
  version: string;
  comment: string;
  quantity: number;
  cost: string;
}

export interface Campus {
  id: string;
  name: string | null;
  province: string;
  city: string;
  district: string;
  address: string;
  location: Location;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface University {
  _id?: string | ObjectId;
  id: string;
  name: string;
  slug?: string; // Customizable URL slug
  type: string;
  majorCategory: string | null;
  natureOfRunning: string | null;
  affiliation: string;
  is985: boolean | null;
  is211: boolean | null;
  isDoubleFirstClass: boolean | null;
  campuses: Campus[];
  // Customization fields
  backgroundColor?: string; // Hex color code
  avatarUrl?: string; // University avatar/logo URL
  avatarStorageProvider?: string | null;
  avatarStorageKey?: string | null;
  avatarStorageObjectId?: string | null;
  description?: string; // University description
  website?: string; // Official website
  // Settings
  postReadability?: PostReadability; // Optional, defaults to PUBLIC
  postWritability?: PostWritability; // Optional, defaults to UNIV_MEMBERS
  // Stats (calculated fields)
  studentsCount?: number;
  frequentingArcades?: number[]; // List of arcade IDs frequented by at least 2 university members
  clubsCount?: number;
  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

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

export type SortCriteria = 'shops' | 'machines' | 'density' | (typeof GAME_TITLES)[number]['key'];

export type TransportMethod = undefined | 'transit' | 'walking' | 'riding' | 'driving';

export type RadiusFilter = (typeof RADIUS_OPTIONS)[number];

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

export interface Club {
  _id?: string | ObjectId;
  id: string;
  universityId: string;
  name: string;
  slug?: string; // Customizable URL slug
  description?: string;
  avatarUrl?: string;
  avatarStorageProvider?: string | null;
  avatarStorageKey?: string | null;
  avatarStorageObjectId?: string | null;
  backgroundColor?: string;
  website?: string;
  // Settings
  acceptJoinRequests: boolean;
  postReadability: PostReadability;
  postWritability: PostWritability;
  // Stats
  membersCount?: number;
  // Starred arcades
  starredArcades: number[];
  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string; // User ID of creator
}

export interface ClubMember {
  _id?: string | ObjectId;
  id: string;
  clubId: string;
  userId: string;
  memberType: 'member' | 'moderator' | 'admin';
  joinedAt: Date;
  invitedBy?: string | null; // User ID of who invited them
}

// Composite type with user data joined
export interface ClubMemberWithUser extends ClubMember {
  user: User | undefined;
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

export interface UniversityMember {
  _id?: string | ObjectId;
  id: string;
  universityId: string;
  userId: string;
  memberType: 'student' | 'moderator' | 'admin';
  verificationEmail?: string;
  verifiedAt?: Date;
  joinedAt: Date;
}

// Composite type with user data joined
export interface UniversityMemberWithUser extends Omit<UniversityMember, 'verificationEmail'> {
  user: User | undefined;
}

export interface ShopDeleteRequest {
  _id?: string | ObjectId;
  id: string;
  shopId: number;
  shopName: string;
  reason: string;
  images?: string[];
  resolvedImages?: ImageAsset[];
  requestedBy: string | null;
  requestedByName?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
  reviewedAt?: Date | null;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  // Optional: if set, this is a photo delete request (not a shop delete request)
  photoId?: string | null;
  photoUrl?: string | null;
}

export type ShopDeleteRequestVoteType = 'favor' | 'against';

export interface ShopDeleteRequestVote {
  _id?: string | ObjectId;
  id: string;
  shopDeleteRequestId: string;
  userId: string;
  voteType: ShopDeleteRequestVoteType;
  createdAt: Date;
  updatedAt?: Date;
}

export interface ShopDeleteRequestVoteSummary {
  favorVotes: number;
  againstVotes: number;
  userVote?: ShopDeleteRequestVoteType | null;
}

export type ImageStorageProvider = 's3' | 'leancloud';

export interface ImageAsset {
  _id?: string | ObjectId;
  id: string;
  shopId?: number;
  commentId?: string;
  postId?: string;
  deleteRequestId?: string;
  url: string;
  storageProvider: ImageStorageProvider;
  storageKey: string;
  storageObjectId?: string | null;
  uploadedBy: string | null;
  uploader?: User;
  uploadedAt: Date;
}

export type ShopPhoto = ImageAsset & {
  shopId: number;
};

export type ShopChangelogAction =
  | 'created'
  | 'modified'
  | 'deleted'
  | 'game_added'
  | 'game_modified'
  | 'game_deleted'
  | 'photo_uploaded'
  | 'photo_deleted'
  | 'rollback'
  | 'delete_request_submitted'
  | 'delete_request_approved'
  | 'delete_request_rejected'
  | 'photo_delete_request_submitted'
  | 'photo_delete_request_approved'
  | 'photo_delete_request_rejected';

export interface ShopChangelogEntry {
  _id?: string | ObjectId;
  id: string;
  shopId: number;
  shopName: string;
  action: ShopChangelogAction;
  fieldInfo: {
    field: string; // 'name' | 'comment' | 'address' | 'openingHours' | 'location' | 'game' | 'photo' | 'delete_request'
    gameId?: number | null;
    gameName?: string | null;
    gameVersion?: string | null;
    photoId?: string | null;
    photoUrl?: string | null;
    deleteRequestId?: string | null;
  };
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: {
    [key: string]: unknown;
  };
  userId: string | null;
  createdAt: Date;
}

export interface ShopChangelogEntryWithUser extends ShopChangelogEntry {
  user?: {
    id: string;
    name: string | null;
    displayName?: string | null;
    image: string | null;
  };
}

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
  user: User | undefined;
  reviewer?: User;
}

export interface ChangelogEntry {
  _id?: string | ObjectId;
  id: string;
  type: 'university' | 'club';
  targetId: string; // University ID or Club ID
  action: 'created' | 'modified' | 'deleted' | 'campus_added' | 'campus_updated' | 'campus_deleted';
  // Structured field information for internationalization
  fieldInfo: {
    field: string; // Field name in English (e.g., 'name', 'description', 'campus.address')
    campusId?: string | null; // If this is a campus field change
    campusName?: string | null; // Campus name for display
  };
  oldValue?: string | null;
  newValue?: string | null;
  // Additional metadata for complex changes
  metadata?: {
    [key: string]: string | number | boolean | null;
  };
  userId: string; // Who made the change
  userName?: string | null;
  userImage?: string | null;
  createdAt: Date;
}

export interface ChangelogEntryWithUser extends ChangelogEntry {
  user: {
    id: string;
    name: string | null;
    displayName?: string | null;
    image: string | null;
  };
}

// Posts feature types
export interface Post {
  _id?: string | ObjectId;
  id: string;
  title: string;
  content: string; // Markdown content
  images?: string[];
  // Organization affiliation - either universityId or clubId will be set
  universityId?: string;
  clubId?: string;
  // Author information
  createdBy: string; // User ID
  createdAt: Date;
  updatedAt?: Date;
  // Engagement metrics
  upvotes: number;
  downvotes: number;
  commentCount: number;
  // Moderation
  isPinned: boolean;
  isLocked: boolean;
  // Post visibility setting
  readability: PostReadability; // Required - determines who can read this specific post
}

// Composite type with author data joined
export interface PostWithAuthor extends Post {
  author: User | undefined;
  resolvedImages?: ImageAsset[];
}

export interface PostVote {
  _id?: string | ObjectId;
  id: string;
  postId: string;
  userId: string;
  voteType: 'upvote' | 'downvote';
  createdAt: Date;
  updatedAt?: Date;
}

export interface Comment {
  _id?: string | ObjectId;
  id: string;
  postId?: string;
  shopId?: number;
  shopDeleteRequestId?: string;
  content: string; // Markdown content
  images?: string[];
  createdBy: string; // User ID
  createdAt: Date;
  updatedAt?: Date;
  // For nested replies
  parentCommentId?: string | null;
  // Engagement
  upvotes: number;
  downvotes: number;
}

// Composite type with author data joined
export interface CommentWithAuthorAndVote extends Comment {
  author: User | undefined;
  vote?: CommentVote;
  authorDeleteRequestVote?: ShopDeleteRequestVote | null;
  resolvedImages?: ImageAsset[];
}

export interface CommentVote {
  _id?: string | ObjectId;
  id: string;
  commentId: string;
  userId: string;
  voteType: 'upvote' | 'downvote';
  createdAt: Date;
  updatedAt?: Date;
}

// Activity types for recent activity feature
export interface Activity {
  _id?: string | ObjectId;
  id: string;
  type:
    | 'post'
    | 'comment'
    | 'reply'
    | 'shop_comment'
    | 'shop_reply'
    | 'post_vote'
    | 'comment_vote'
    | 'shop_comment_vote'
    | 'shop_delete_request_comment'
    | 'shop_delete_request_reply'
    | 'shop_delete_request_comment_vote'
    | 'shop_delete_request_vote'
    | 'changelog'
    | 'university_join'
    | 'club_join'
    | 'club_create'
    | 'shop_attendance';
  createdAt: Date;
  userId: string;

  // Post activity
  postTitle?: string;
  postId?: string;
  universityId?: string;
  clubId?: string;
  universityName?: string;
  clubName?: string;

  // Comment activity
  commentContent?: string;
  commentId?: string;
  parentCommentId?: string | null;
  parentPostTitle?: string;

  // Vote activity
  voteType?: 'upvote' | 'downvote';
  targetType?:
    | 'post'
    | 'comment'
    | 'reply'
    | 'shop_comment'
    | 'shop_reply'
    | 'shop_delete_request'
    | 'shop_delete_request_comment'
    | 'shop_delete_request_reply';
  targetTitle?: string;
  targetAuthorName?: string;
  targetAuthorDisplayName?: string;
  targetId?: string;

  // Changelog activity
  changelogAction?: string;
  changelogDescription?: string;
  changelogTargetName?: string;
  changelogTargetId?: string;
  changelogEntry?: ChangelogEntry; // Store the full entry for proper formatting

  // Membership activity (university_join, club_join)
  joinedUniversityId?: string;
  joinedUniversityName?: string;
  joinedClubId?: string;
  joinedClubName?: string;

  // Club creation activity (club_create)
  createdClubId?: string;
  createdClubName?: string;

  // Shop attendance activity (shop_attendance)
  shopId?: number;
  shopName?: string;
  leaveAt?: Date;
  attendanceGames?: string; // Comma-separated game names
  isLive?: boolean; // Whether the attendance is still ongoing

  // Shop delete request activity
  shopDeleteRequestId?: string;
  shopDeleteRequestType?: 'shop' | 'photo';
  shopDeleteRequestVoteType?: ShopDeleteRequestVoteType;
}

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
  user?: User;
  attendedAt: string;
  plannedLeaveAt: string;
  gameId: number;
}>;

export type AttendanceReport = Array<{
  gameId: number;
  currentAttendances?: number;
  reportedBy: string;
  reporter?: User;
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

// Extended types for route guidance
export interface CachedRouteData {
  routeData: TransportSearchResult;
  selectedRouteIndex: number;
}

export interface RouteGuidanceState {
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
    reportedBy: User;
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

// Shop with computed attendance and opening-hours data, used on the globe views.
export interface ShopWithExtras extends Shop {
  attendances: { gameId: number; total: number }[];
  openingHoursParsed: {
    open: Date;
    close: Date;
    openTolerated: Date;
    closeTolerated: Date;
    offsetHours: number;
    openLocal: string;
    closeLocal: string;
  };
  currentAttendance: number;
  density: number;
}

export * from './amap';

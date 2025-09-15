import type { ObjectId } from 'mongodb';
import type { RADIUS_OPTIONS, ShopSource, GAMES } from '../constants';
import type { TransportSearchResult } from './amap';
import type { User } from '@auth/sveltekit';

export interface Location {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
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
  openingHours: [openHour: number, closeHour: number][];
  location: Location;
  games: Game[];
  createdAt?: Date;
  updatedAt: Date;
  source: ShopSource;
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
  description?: string; // University description
  website?: string; // Official website
  // Settings
  postReadability?: PostReadability; // Optional, defaults to PUBLIC
  postWritability?: PostWritability; // Optional, defaults to UNIV_MEMBERS
  // Stats (calculated fields)
  studentsCount?: number;
  frequentingArcades?: { id: number; source: ShopSource }[]; // List of arcade IDs frequented by at least 2 university members
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

export type SortCriteria = 'shops' | 'machines' | 'density' | (typeof GAMES)[number]['key'];

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
  | 'JOIN_REQUESTS';

export interface Club {
  _id?: string | ObjectId;
  id: string;
  universityId: string;
  name: string;
  slug?: string; // Customizable URL slug
  description?: string;
  avatarUrl?: string;
  backgroundColor?: string;
  website?: string;
  // Settings
  acceptJoinRequests: boolean;
  postReadability: PostReadability;
  postWritability: PostWritability;
  // Stats
  membersCount?: number;
  // Starred arcades
  starredArcades: { id: number; source: ShopSource }[];
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
  user: {
    id: string;
    name: string | null;
    displayName?: string | null;
    email: string | null;
    image: string | null;
    userType: string | null;
  };
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
  user: {
    id: string;
    name: string | null;
    displayName?: string | null;
    email: string | null;
    image: string | null;
    userType: string | null;
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
  user: {
    _id: string;
    id: string;
    name: string | null;
    displayName?: string | null;
    email: string | null;
    image: string | null;
    userType: string | null;
  };
  reviewer?: {
    _id: string;
    id: string;
    name: string | null;
    displayName?: string | null;
    email: string | null;
    image: string | null;
    userType: string | null;
  };
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
  author: {
    id: string;
    name: string | null;
    displayName?: string | null;
    email: string | null;
    image: string | null;
    userType: string | null;
  };
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
  postId: string;
  content: string; // Markdown content
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
  author: {
    id: string;
    name: string | null;
    displayName?: string | null;
    email: string | null;
    image: string | null;
    userType: string | null;
  };
  vote?: CommentVote;
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
    | 'post_vote'
    | 'comment_vote'
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
  targetType?: 'post' | 'comment' | 'reply';
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
  shopSource?: string;
  leaveAt?: Date;
  attendanceGames?: string; // Comma-separated game names
  isLive?: boolean; // Whether the attendance is still ongoing
}

// Notification types for active notification system
export interface Notification {
  _id?: string | ObjectId;
  id: string;
  type: 'COMMENTS' | 'REPLIES' | 'POST_VOTES' | 'COMMENT_VOTES' | 'JOIN_REQUESTS';
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

  // Join request details
  joinRequestId?: string;
  joinRequestStatus?: 'approved' | 'rejected';
  joinRequestType?: 'university' | 'club';

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
}>;

// Interface for attendance records in MongoDB
export interface AttendanceRecord {
  _id?: string;
  userId: string;
  games: { gameId: number; name: string; version: string }[];
  attendedAt: Date;
  leftAt: Date;
  shop: { id: number; source: ShopSource };
}

export interface AttendanceReportRecord {
  _id?: string | ObjectId;
  shop: { id: number; source: ShopSource };
  games: { gameId: number; name: string; version: string; currentAttendances: number }[];
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
  currentAttendance?: number;
  currentReportedAttendance?: {
    count: number;
    reportedAt: string;
    reportedBy: User;
  } | null;
  isInAttendance?: boolean;
}

export * from './amap';

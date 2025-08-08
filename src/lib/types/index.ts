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
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface University {
  _id?: string;
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
  // Legacy aliases for backward compatibility
  discussionReadability?: PostReadability;
  discussionWritability?: PostWritability;
  // Stats (calculated fields)
  studentsCount?: number;
  frequentingArcades?: number[]; // List of arcade IDs frequented by at least 2 university members
  clubsCount?: number;
  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AMapContext {
  amap: typeof AMap | undefined;
  error: string | null;
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

// Post permission enums
export enum PostReadability {
  PUBLIC = 0, // Anyone can read
  UNIV_MEMBERS = 1, // Only university members can read
  CLUB_MEMBERS = 2 // Only club members can read
}

export enum PostWritability {
  UNIV_MEMBERS = 0, // All university members can write
  CLUB_MEMBERS = 1, // Only club members can write
  ADMIN_AND_MODS = 2 // Only admins and moderators can write
}

// Legacy aliases for backward compatibility
export const DiscussionReadability = PostReadability;
export const DiscussionWritability = PostWritability;

// User types and roles
export type UserType =
  | 'student'
  | 'school_moderator'
  | 'school_admin'
  | 'club_admin'
  | 'club_moderator'
  | 'site_admin';

export interface Club {
  _id?: string;
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
  // Legacy aliases for backward compatibility
  discussionReadability?: PostReadability;
  discussionWritability?: PostWritability;
  // Stats
  membersCount?: number;
  // Starred arcades (shop IDs)
  starredArcades: string[];
  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string; // User ID of creator
}

export interface ClubMember {
  _id?: string;
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
  _id?: string;
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
  _id?: string;
  id: string;
  universityId: string;
  userId: string;
  memberType: 'student' | 'moderator' | 'admin';
  verificationEmail?: string;
  joinedAt: Date;
}

// Composite type with user data joined
export interface UniversityMemberWithUser extends UniversityMember {
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
  _id?: string;
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

export interface Discussion {
  _id?: string;
  id: string;
  type: 'university' | 'club';
  targetId: string; // University ID or Club ID
  title: string;
  content: string;
  authorId: string;
  authorName?: string | null;
  authorImage?: string | null;
  isPinned: boolean;
  isLocked: boolean;
  replyCount: number;
  lastReplyAt?: Date | null;
  lastReplyBy?: string | null;
  createdAt: Date;
  updatedAt?: Date;
}

export interface DiscussionReply {
  _id?: string;
  id: string;
  discussionId: string;
  content: string;
  authorId: string;
  authorName?: string | null;
  authorImage?: string | null;
  replyToId?: string | null; // ID of reply being replied to
  createdAt: Date;
  updatedAt?: Date;
}

export interface Announcement {
  _id?: string;
  id: string;
  type: 'university' | 'club';
  targetId: string; // University ID or Club ID
  title: string;
  content: string;
  authorId: string;
  authorName?: string | null;
  authorImage?: string | null;
  isPinned: boolean;
  isImportant: boolean; // For highlighting important announcements
  createdAt: Date;
  updatedAt?: Date;
}

export interface ChangelogEntry {
  _id?: string;
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

// Posts feature types
export interface Post {
  _id?: string;
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
  _id?: string;
  id: string;
  postId: string;
  userId: string;
  voteType: 'upvote' | 'downvote';
  createdAt: Date;
  updatedAt?: Date;
}

export interface Comment {
  _id?: string;
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
export interface CommentWithAuthor extends Comment {
  author: {
    id: string;
    name: string | null;
    displayName?: string | null;
    email: string | null;
    image: string | null;
    userType: string | null;
  };
}

export interface CommentVote {
  _id?: string;
  id: string;
  commentId: string;
  userId: string;
  voteType: 'upvote' | 'downvote';
  createdAt: Date;
  updatedAt?: Date;
}

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

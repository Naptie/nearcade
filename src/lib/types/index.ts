import type { ObjectId } from 'mongodb';
import type {
  GAME_TITLES,
  RANKING_RADIUS_OPTIONS,
  METRO_RANKING_RADIUS_OPTIONS
} from '../constants';
import type { TransportSearchResult } from './amap';
import type { PublicUser } from '$lib/auth/types';
import { z } from 'zod';
import { activitySchema } from '$lib/schemas/users';
import { commentSchema, commentVoteSchema } from '$lib/schemas/comments';
import {
  imageAssetSchema,
  imageDocumentSchema,
  imageStorageProviderSchema
} from '$lib/schemas/images';
import type { locationSchema, openingHourTimeSchema, StorageId } from '$lib/schemas/common';
import type {
  campusSchema,
  clubMemberSchema,
  clubSchema,
  organizationChangelogEntrySchema,
  universityMemberSchema,
  universitySchema
} from '$lib/schemas/organizations';
import type { postWithAuthorSchema } from '$lib/schemas/posts';
import type { announcementSchema, announcementWithAuthorSchema } from '$lib/schemas/announcements';
import type {
  gameSchema,
  shopApiAddressSchema,
  shopApiSchema,
  shopDeleteRequestVoteSchema,
  shopDeleteRequestVoteTypeSchema,
  shopDocumentSchema,
  shopPhotoSchema
} from '$lib/schemas/shops';
import { shopChangelogEntrySchema } from '$lib/schemas/shops';
import type { AddressRegionEntry } from '$lib/regions/types';
import type { UgcContentType, UgcKind, UgcTranslationMap } from '$lib/ugc/types';
import type {
  RankingMetrics,
  RegionLevel,
  RegionRankingData,
  RegionRankingResponse,
  UniversityRankingData,
  UniversityRankingResponse
} from '$lib/schemas/rankings';

/**
 * Server loaders attach cached UGC translations to entities as
 * `_t[field][locale]` (see `$lib/ugc/translate.server.ts`). Runtime-only:
 * never persisted and never part of API schemas.
 */
export type UgcAttachable = {
  _t?: UgcTranslationMap;
};

export type Location = z.infer<typeof locationSchema>;

export type OpeningHourTime = z.infer<typeof openingHourTimeSchema>;

/**
 * The persisted shop document (MongoDB / Meilisearch). Carries `_id` and the
 * derived cache fields that exist purely to serve server-side filtering and
 * sorting. Never returned to clients — see {@link ShopApi}.
 */
type ShopDocumentBase = z.infer<typeof shopDocumentSchema>;

export type Shop = UgcAttachable &
  Omit<ShopDocumentBase, 'games'> & {
    /** Per-game entries may carry their own cached translations (`_t`). */
    games: Array<z.infer<typeof gameSchema> & UgcAttachable>;
  };

/**
 * Public (API-facing) shop address: localized `general` plus the region chain
 * with IDs and the requested locale's names. Stored shops keep IDs only — see
 * `shopAddressSchema` and `toShopApiAddress`.
 */
export type ShopApiAddress = z.infer<typeof shopApiAddressSchema>;

/**
 * A shop as the API returns it, plus the UGC decorations a page may attach.
 *
 * This is the browser-facing shop type: the public projection of the Mongo
 * document (`shopApiSchema`), with the optional UGC fields merged into the shop
 * and into each game. It is the only `ShopApi` in the codebase — a second,
 * differently-shaped alias used to live next to `shopApiSchema` and an import
 * could silently pick up the narrower one.
 */
type ShopApiBase = z.infer<typeof shopApiSchema>;

export type ShopApi = UgcAttachable &
  Omit<ShopApiBase, 'games'> & {
    games: Array<z.infer<typeof gameSchema> & UgcAttachable>;
  };

/**
 * Metro (openmetro) types re-exported for the browser. The zod schemas in
 * `$lib/schemas/metro` are the single source of truth (they describe the
 * discover API response), so importing the inferred types keeps the client and
 * the API in lockstep.
 */
export type {
  ShopMetro,
  DiscoverMetroBlock,
  MetroLegPlan,
  MetroShopItinerary,
  MetroStationRanking
} from '$lib/schemas/metro';

/** Per-shop fastest-mode estimate carried by the discover response. */
export type { ShopTravelEstimate, MetroItinerary } from '$lib/utils/travel';

export type Game = z.infer<typeof gameSchema> & UgcAttachable;

export type Campus = z.infer<typeof campusSchema>;

/**
 * A stored university.
 *
 * The published shape leaves the storage identifier out; the stored document
 * still carries it, so the server's type adds it back.
 */
export type University = UgcAttachable & z.infer<typeof universitySchema> & { _id?: StorageId };

/**
 * The ranking row, metric and response shapes belong to the API, so they are
 * re-exported from the schema instead of restated here. They used to be
 * hand-written interfaces that the contracts described as "mirrors" of their
 * schemas, with nothing keeping the two in step — and they had drifted:
 * `cacheTime` was `Date` on the campus response and `string` on the region one,
 * while the schema (and the published document) say `string | null`.
 */
export type {
  RankingMetrics,
  RegionLevel,
  RegionRankingData,
  RegionRankingResponse,
  UniversityRankingData,
  UniversityRankingResponse
};

export interface RankingsTableItem {
  id: string;
  rankings: RankingMetrics[];
}

export type SortCriteria =
  'shops' | 'machines' | 'density' | 'per_capita' | (typeof GAME_TITLES)[number]['key'];

/**
 * Travel method driving the discover view. These select an *AMap* network
 * lookup for the table's travel column; the server-computed openmetro
 * itineraries (walk / ride / metro) are always shown in the panel regardless
 * of this choice, so there is no separate "metro" method.
 */
export type TransportMethod = undefined | 'transit' | 'walking' | 'riding' | 'driving';

/** Methods computed by the AMap plugins (all of them — `undefined` means none). */
export type AMapTransportMethod = Exclude<TransportMethod, undefined>;

export type RankingRadiusFilter = (typeof RANKING_RADIUS_OPTIONS)[number];

export type MetroRankingRadiusFilter = (typeof METRO_RANKING_RADIUS_OPTIONS)[number];

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

/**
 * A stored club.
 *
 * The published shape leaves the storage identifier out; the stored document
 * still carries it, so the server's type adds it back.
 */
export type Club = UgcAttachable & z.infer<typeof clubSchema> & { _id?: StorageId };

export type ClubMember = z.infer<typeof clubMemberSchema> & { _id?: StorageId };

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

export type UniversityMember = z.infer<typeof universityMemberSchema> & { _id?: StorageId };

// Composite type with user data joined
export interface UniversityMemberWithUser extends Omit<UniversityMember, 'verificationEmail'> {
  user: PublicUser | undefined;
}

export type ShopDeleteRequestVoteType = z.infer<typeof shopDeleteRequestVoteTypeSchema>;

export type ShopDeleteRequestVote = z.infer<typeof shopDeleteRequestVoteSchema>;

export type ImageStorageProvider = z.infer<typeof imageStorageProviderSchema>;

/**
 * An image as the API returns it: what a consumer needs to render it and to
 * refer to it.
 */
export type ImageAsset = z.infer<typeof imageAssetSchema>;

/**
 * A stored image: the published shape plus the storage bookkeeping the server
 * needs to delete the bytes again.
 */
export type StoredImageAsset = z.infer<typeof imageDocumentSchema>;

export type ShopPhoto = z.infer<typeof shopPhotoSchema>;

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

/**
 * A changelog entry together with the author it was written by.
 *
 * The author comes from the same schema as the entry itself, so the typed API
 * client returns exactly this shape — the lookup may leave it absent.
 */
export type ChangelogEntryWithUser = ChangelogEntry;

export type PostWithAuthor = z.infer<typeof postWithAuthorSchema> & UgcAttachable;

export type Announcement = z.infer<typeof announcementSchema> & UgcAttachable;

export type AnnouncementWithAuthor = z.infer<typeof announcementWithAuthorSchema> & UgcAttachable;

export type Comment = z.infer<typeof commentSchema> & UgcAttachable;

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
export type { ActivityType } from '$lib/schemas/users';

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
    | 'SHOP_DELETE_REQUESTS'
    | 'SYSTEM';
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
  shopDeleteRequestStatus?: 'approved' | 'rejected' | 'deleted';
  shopDeleteRequestType?: 'shop' | 'photo';
  shopName?: string;

  // System (moderation) notification details
  /** Coarse entity family (shop / comment / post / ...) — drives deep links. */
  kind?: UgcKind;
  /**
   * Discriminates platform-generated SYSTEM notices beyond UGC removals:
   * `'rollback'` = an admin rolled back the recipient's shop changes (and
   * possibly removed their photos from that shop). Legacy rows and removal
   * notices omit it and keep the content-removed rendering.
   */
  noticeKind?: 'rollback';
  /**
   * Precise per-field content type that was moderated (e.g. `game_cost`,
   * `bio`). Rendered as the noun in system removal messages when present;
   * falls back to `kind` for legacy rows. `content` holds the (masked)
   * source text for these notifications.
   */
  contentType?: UgcContentType;
  refId?: string;
  reason?: string;
  reviewedBy?: string;

  // Navigation
  universityId?: string;
  clubId?: string;
  universityName?: string;
  clubName?: string;
}

/**
 * The user summary the attendance endpoints return.
 *
 * The API contract documents exactly these four fields, so the browser and the
 * server share this shape.
 */
export type AttendanceUser = Pick<PublicUser, 'id' | 'name' | 'displayName' | 'image'>;

export type AttendanceData = Array<{
  userId?: string;
  user?: AttendanceUser;
  /** An ISO timestamp on the server, a `Date` once the typed client decoded it. */
  attendedAt: string | Date;
  plannedLeaveAt: string | Date;
  gameId: number;
}>;

export type AttendanceReport = Array<{
  gameId: number;
  currentAttendances?: number;
  reportedBy: string;
  reporter?: AttendanceUser;
  reportedAt: string | Date;
  comment: string | null;
}>;

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

// Kiosk machine for queue management
export interface Machine {
  _id?: string | ObjectId;
  id: string;
  name: string;
  shopId: number;
  ownerId?: string; // User ID of the owner assigned to this machine
  serialNumber: string; // Auto-generated, used for activation
  apiSecretHash?: string; // SHA-256 hex of the API secret, generated upon activation
  isActivated: boolean;
  createdAt: Date;
  updatedAt: Date;
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
    region?: AddressRegionEntry[];
  };
  openingHours: Shop['openingHours'];
  location: Shop['location'];
  aggregatedGames: GlobeShopGameSummary[];
  currentAttendance: number;
  density: number;
  isClosed?: boolean;
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

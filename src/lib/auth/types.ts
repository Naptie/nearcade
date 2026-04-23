import type { ShopSource, SocialPlatform } from '$lib/constants';
import type { NotificationType, UserType } from '$lib/types';
import type { ObjectId } from 'mongodb';

export interface User {
  id: string;
  _id?: string | ObjectId;
  name: string | null;
  email?: string;
  emailVerified?: boolean;
  image?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  displayName?: string | null;
  userType?: UserType;
  bio?: string | null;
  joinedAt?: Date;
  lastActiveAt?: Date;
  frequentingArcades?: { id: number; source: ShopSource }[];
  starredArcades?: { id: number; source: ShopSource }[];
  autoDiscovery?: {
    discoveryInteractionThreshold: number;
    attendanceThreshold: number;
  };
  isEmailPublic?: boolean;
  isActivityPublic?: boolean;
  isFootprintPublic?: boolean;
  isUniversityPublic?: boolean;
  isFrequentingArcadePublic?: boolean;
  isStarredArcadePublic?: boolean;
  notificationTypes?: NotificationType[];
  fcmTokens?: string[];
  fcmTokenUpdatedAt?: Date;
  socialLinks?: {
    platform: SocialPlatform;
    username: string;
  }[];
  apiTokens?: {
    id: string;
    name: string;
    token: string;
    shop?: { id: number; source: ShopSource };
    expiresAt: Date;
    createdAt: Date;
  }[];
}

export interface Session {
  expiresAt: Date;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  unreadNotifications: number;
  pendingJoinRequests: number;
}

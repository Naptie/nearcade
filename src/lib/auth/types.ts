import type { SocialPlatform } from '$lib/constants';
import type { NotificationType, UserType } from '$lib/types';
import type { ObjectId } from 'mongodb';

export interface User {
  id: string;
  _id?: string | ObjectId;
  name: string;
  email?: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  displayName?: string | null;
  userType?: UserType;
  bio?: string | null;
  joinedAt?: Date;
  lastActiveAt?: Date;
  frequentingArcades?: number[];
  starredArcades?: number[];
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
    shopId?: number;
    expiresAt: Date;
    createdAt: Date;
  }[];
}

export interface Session {
  id: string;
  expiresAt: Date;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
  unreadNotifications: number;
  pendingJoinRequests: number;
}

export interface AuthSession {
  user: User;
  session: Session;
}

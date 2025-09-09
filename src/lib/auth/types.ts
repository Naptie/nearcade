import type { ShopSource } from '$lib/constants';
import type { NotificationType, UserType } from '$lib/types';
import type { ObjectId } from 'mongodb';

declare module '@auth/sveltekit' {
  export interface User {
    _id?: string | ObjectId;
    displayName?: string | null;
    userType?: UserType;
    bio?: string | null;
    joinedAt?: Date;
    lastActiveAt?: Date;
    frequentingArcades?: { id: number; source: ShopSource }[];
    starredArcades?: { id: number; source: ShopSource }[];
    autoDiscoveryThreshold?: number; // Number of clicks before auto-adding to frequenting arcades
    isEmailPublic?: boolean;
    isActivityPublic?: boolean;
    isFootprintPublic?: boolean;
    isUniversityPublic?: boolean;
    isFrequentingArcadePublic?: boolean;
    isStarredArcadePublic?: boolean;
    notificationTypes?: NotificationType[];
    fcmTokens?: string[]; // Firebase Cloud Messaging tokens
    fcmTokenUpdatedAt?: Date; // Last time FCM tokens were updated
  }

  export interface Session {
    unreadNotifications: number;
    pendingJoinRequests?: number;
  }
}

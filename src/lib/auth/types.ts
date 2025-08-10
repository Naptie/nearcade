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
    frequentingArcades?: number[];
    starredArcades?: number[];
    autoDiscoveryThreshold?: number; // Number of clicks before auto-adding to frequenting arcades
    isEmailPublic?: boolean;
    isActivityPublic?: boolean;
    isFootprintPublic?: boolean;
    isUniversityPublic?: boolean;
    isFrequentingArcadePublic?: boolean;
    isStarredArcadePublic?: boolean;
    notificationReadAt?: Date;
    notificationTypes?: NotificationType[];
  }

  export interface Session {
    unreadNotifications: number;
    pendingJoinRequests?: number;
  }
}

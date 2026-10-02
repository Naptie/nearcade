import { z } from 'zod';

import { userPublicSchema, userSchema } from '$lib/schemas/common';

export type PublicUser = z.infer<typeof userPublicSchema>;
export type User = z.infer<typeof userSchema>;

export interface Session {
  id: string;
  expiresAt: Date;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
}

export interface AuthSession {
  user: User;
  session: Session;
}

export interface NavigationCounts {
  unreadNotifications: number;
  pendingJoinRequests: number;
  unreadAnnouncements: number;
}

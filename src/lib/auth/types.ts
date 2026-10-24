import { z } from 'zod';

import { userPublicSchema, userSchema, type StorageId } from '$lib/schemas/common';

export type PublicUser = z.infer<typeof userPublicSchema>;

/**
 * A stored user.
 *
 * The published shape leaves the storage identifier out; the stored document
 * still carries it, so the server's type adds it back.
 */
export type User = z.infer<typeof userSchema> & { _id?: StorageId };

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

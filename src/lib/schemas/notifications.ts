import { z } from 'zod';
import { nonEmptyTrimmedStringSchema } from './common';

export const notificationsActionSchema = z.object({
  action: z.literal('markAsRead')
});

export const fcmTokenActionSchema = z.object({
  token: nonEmptyTrimmedStringSchema,
  action: z.enum(['store', 'remove'])
});

export type NotificationsActionRequest = z.infer<typeof notificationsActionSchema>;
export type FcmTokenActionRequest = z.infer<typeof fcmTokenActionSchema>;

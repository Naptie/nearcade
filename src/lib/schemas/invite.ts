import { z } from 'zod';
import { nullableTrimmedStringSchema, nonEmptyTrimmedStringSchema } from './common';

export const createInviteRequestSchema = z.object({
  type: z.enum(['university', 'club']),
  targetId: nonEmptyTrimmedStringSchema,
  title: nullableTrimmedStringSchema,
  description: nullableTrimmedStringSchema,
  expiresAt: z.string().datetime().nullable().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  requireApproval: z.boolean().optional()
});

export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

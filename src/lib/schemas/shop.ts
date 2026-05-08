import { z } from 'zod';
import { imageIdsSchema, nonEmptyTrimmedStringSchema, optionalTrimmedStringSchema } from './common';

export const openingHourTimeSchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59)
});

export const locationSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90)
  ])
});

export const shopGameInputSchema = z.object({
  gameId: z.number().int().optional(),
  titleId: z.number().int().nonnegative(),
  name: nonEmptyTrimmedStringSchema,
  version: nonEmptyTrimmedStringSchema,
  comment: z.string().default(''),
  cost: z.string().default(''),
  quantity: z.number().int().nonnegative().default(1)
});

export const shopFormSchema = z.object({
  name: nonEmptyTrimmedStringSchema,
  comment: z.string().default(''),
  address: z.object({
    general: z.array(nonEmptyTrimmedStringSchema).max(4).default([]),
    detailed: z.string().default('')
  }),
  openingHours: z
    .array(z.tuple([openingHourTimeSchema, openingHourTimeSchema]))
    .min(1)
    .max(7),
  location: locationSchema,
  games: z.array(shopGameInputSchema.omit({ gameId: true })).default([])
});

export const createShopRequestSchema = shopFormSchema;

export const updateShopRequestSchema = z
  .object({
    name: nonEmptyTrimmedStringSchema.optional(),
    comment: z.string().optional(),
    address: z
      .object({
        general: z.array(nonEmptyTrimmedStringSchema).max(4).optional(),
        detailed: z.string().optional()
      })
      .optional(),
    openingHours: z
      .array(z.tuple([openingHourTimeSchema, openingHourTimeSchema]))
      .min(1)
      .max(7)
      .optional(),
    location: locationSchema.optional(),
    games: z.array(shopGameInputSchema).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'No fields to update'
  });

export const shopDeleteRequestCreateSchema = z.object({
  reason: nonEmptyTrimmedStringSchema,
  photoId: optionalTrimmedStringSchema,
  images: imageIdsSchema.optional()
});

export const rollbackRequestSchema = z.object({
  targetEntryId: optionalTrimmedStringSchema
});

export const queueMemberSchema = z.object({
  slotIndex: nonEmptyTrimmedStringSchema,
  userId: z.string().trim().min(1).nullable()
});

export const queuePositionSchema = z.object({
  machineName: z.string().default(''),
  position: z.number().int(),
  isPublic: z.boolean().default(false),
  status: z.enum(['playing', 'queued', 'deferred']),
  members: z.array(queueMemberSchema)
});

export const queueUpdateRequestSchema = z.object({
  queues: z.array(
    z.object({
      gameId: z.number().int(),
      queue: z.array(queuePositionSchema)
    })
  )
});

export const attendanceRequestSchema = z.object({
  games: z.array(
    z.object({
      id: z.number().int(),
      currentAttendances: z.number().int().nonnegative().optional(),
      attend: z.boolean().optional()
    })
  ),
  plannedLeaveAt: z.string().datetime().optional(),
  comment: z.string().optional()
});

export const attendanceRegistrationRequestSchema = z.object({
  slotIndex: nonEmptyTrimmedStringSchema,
  expires: z.number().int().optional()
});

export type ShopGameInput = z.infer<typeof shopGameInputSchema>;
export type ShopFormData = z.infer<typeof shopFormSchema>;
export type CreateShopRequest = z.infer<typeof createShopRequestSchema>;
export type UpdateShopRequest = z.infer<typeof updateShopRequestSchema>;
export type ShopDeleteRequestCreate = z.infer<typeof shopDeleteRequestCreateSchema>;
export type RollbackRequest = z.infer<typeof rollbackRequestSchema>;
export type QueueUpdateRequest = z.infer<typeof queueUpdateRequestSchema>;
export type AttendanceRequest = z.infer<typeof attendanceRequestSchema>;
export type AttendanceRegistrationRequest = z.infer<typeof attendanceRegistrationRequestSchema>;

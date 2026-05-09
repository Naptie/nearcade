import { z } from 'zod';
import { gameCreateSchema, shopAddressSchema } from './shops';
import { locationSchema, openingHoursSchema } from './common';

export const shopFormSchema = z.object({
  name: z.string().trim().min(1, 'Shop name is required'),
  comment: z.string().default(''),
  address: shopAddressSchema,
  openingHours: openingHoursSchema,
  location: locationSchema,
  games: z.array(gameCreateSchema)
});

export type GameFormData = z.infer<typeof gameCreateSchema>;
export type ShopFormData = z.infer<typeof shopFormSchema>;

export const profileSettingsFormSchema = z.object({
  displayName: z.string().max(50, 'display_name_too_long').optional().default(''),
  bio: z.string().max(500, 'bio_too_long').optional().default(''),
  username: z
    .string()
    .trim()
    .min(1, 'username_required')
    .max(30, 'username_too_long')
    .regex(/^[A-Za-z0-9_-]+$/, 'username_invalid'),
  isEmailPublic: z.boolean(),
  isActivityPublic: z.boolean(),
  isFootprintPublic: z.boolean(),
  isUniversityPublic: z.boolean(),
  isFrequentingArcadePublic: z.boolean(),
  isStarredArcadePublic: z.boolean(),
  notificationTypes: z.array(
    z.enum([
      'COMMENTS',
      'REPLIES',
      'POST_VOTES',
      'COMMENT_VOTES',
      'JOIN_REQUESTS',
      'SHOP_DELETE_REQUESTS'
    ])
  ),
  socialLinks: z.array(
    z.object({
      platform: z.enum(['qq', 'wechat', 'github', 'discord', 'divingfish']),
      username: z.string().trim().min(1)
    })
  )
});

export type ProfileSettingsForm = z.infer<typeof profileSettingsFormSchema>;

import { z } from 'zod';

import { normalizeImageIds } from '$lib/images/index.server';
import { PostReadability } from '$lib/types';

import { imageAssetIdSchema } from './images';

const postReadabilitySchema = z.union([
  z.literal(PostReadability.PUBLIC),
  z.literal(PostReadability.UNIV_MEMBERS),
  z.literal(PostReadability.CLUB_MEMBERS)
]);

const normalizedImageIdsSchema = z.preprocess(
  (value) => normalizeImageIds(value),
  z.array(imageAssetIdSchema)
);

const optionalNormalizedImageIdsSchema = z.preprocess(
  (value) => (value === undefined ? undefined : normalizeImageIds(value)),
  z.array(imageAssetIdSchema).optional()
);

export const postCommentCreateRequestSchema = z
  .object({
    content: z.string().trim().optional().default(''),
    parentCommentId: z.string().trim().min(1).optional(),
    images: normalizedImageIdsSchema
  })
  .refine((value) => value.content.length > 0 || value.images.length > 0, {
    message: 'Comment content or images are required'
  });

export const postCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1),
    content: z.string().trim().optional().default(''),
    readability: postReadabilitySchema.optional(),
    images: normalizedImageIdsSchema
  })
  .refine((value) => value.content.length > 0 || value.images.length > 0, {
    message: 'Post content or images are required'
  });

export const postUpdateRequestSchema = z.object({
  title: z.string().trim().optional(),
  content: z.string().trim().optional(),
  readability: postReadabilitySchema.optional(),
  isPinned: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  images: optionalNormalizedImageIdsSchema
});
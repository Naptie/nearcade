import { z } from 'zod';
import {
  imageIdsSchema,
  nonEmptyTrimmedStringSchema,
  optionalTrimmedStringSchema,
  postReadabilitySchema,
  reviewActionSchema,
  shopDeleteRequestVoteTypeSchema,
  voteTypeSchema
} from './common';

export const postCreateRequestSchema = z.object({
  title: nonEmptyTrimmedStringSchema.max(200).describe('Post title'),
  content: z.string().default('').describe('Markdown content'),
  readability: postReadabilitySchema.optional(),
  images: imageIdsSchema.optional()
});

export const postUpdateRequestSchema = z
  .object({
    title: nonEmptyTrimmedStringSchema.max(200).optional(),
    content: z.string().optional(),
    readability: postReadabilitySchema.optional(),
    isPinned: z.boolean().optional(),
    isLocked: z.boolean().optional(),
    images: imageIdsSchema.optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'No fields to update'
  });

export const commentCreateRequestSchema = z.object({
  content: z.string().default('').describe('Comment markdown content'),
  parentCommentId: optionalTrimmedStringSchema,
  images: imageIdsSchema.optional()
});

export const commentUpdateRequestSchema = z.object({
  content: z.string().default('').describe('Updated comment markdown content'),
  images: imageIdsSchema.optional()
});

export const voteRequestSchema = z.object({
  voteType: voteTypeSchema
});

export const shopDeleteRequestVoteSchema = z.object({
  voteType: shopDeleteRequestVoteTypeSchema
});

export const shopDeleteRequestReviewSchema = z.object({
  action: reviewActionSchema,
  reviewNote: z.string().nullable().optional()
});

export type PostCreateRequest = z.infer<typeof postCreateRequestSchema>;
export type PostUpdateRequest = z.infer<typeof postUpdateRequestSchema>;
export type CommentCreateRequest = z.infer<typeof commentCreateRequestSchema>;
export type CommentUpdateRequest = z.infer<typeof commentUpdateRequestSchema>;
export type VoteRequest = z.infer<typeof voteRequestSchema>;
export type ShopDeleteRequestVoteRequest = z.infer<typeof shopDeleteRequestVoteSchema>;
export type ShopDeleteRequestReviewRequest = z.infer<typeof shopDeleteRequestReviewSchema>;

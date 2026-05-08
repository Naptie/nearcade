import { z } from 'zod';
import { PostReadability } from '$lib/types';

export const trimmedStringSchema = z.string().trim();
export const optionalTrimmedStringSchema = trimmedStringSchema.optional();
export const nullableTrimmedStringSchema = trimmedStringSchema.nullable().optional();
export const nonEmptyTrimmedStringSchema = trimmedStringSchema.min(1);

export const imageIdsSchema = z.array(nonEmptyTrimmedStringSchema).default([]);

export const postReadabilitySchema = z.nativeEnum(PostReadability);
export const voteTypeSchema = z.enum(['upvote', 'downvote']);
export const shopDeleteRequestVoteTypeSchema = z.enum(['favor', 'against']);
export const reviewActionSchema = z.enum(['approve', 'reject']);

export const validationMessage = (issues: z.ZodIssue[], fallback = 'Invalid request body') =>
  issues[0]?.message ?? fallback;

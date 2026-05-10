import { z } from 'zod';

import {
  bilingual,
  dateTimeSchema,
  objectIdSchema,
  positiveIntegerString,
  successResponseSchema,
  userIdSchema,
  userPublicSchema
} from './common';
import { imageAssetIdSchema, imageAssetSchema } from './images';

export const commentIdSchema = z.string().describe(bilingual('评论 ID。', 'Comment ID.'));

export const commentIdParamSchema = z.object({
  commentId: commentIdSchema
});

export const commentVoteTypeSchema = z
  .enum(['upvote', 'downvote'])
  .describe(bilingual('评论投票类型。', 'Comment vote type.'));

export const commentVoteSchema = z
  .object({
    _id: z
      .union([z.string(), objectIdSchema])
      .optional()
      .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: z.string().describe(bilingual('评论投票 ID。', 'Comment vote ID.')),
    commentId: commentIdSchema,
    userId: userIdSchema,
    voteType: commentVoteTypeSchema,
    createdAt: dateTimeSchema(bilingual('投票时间。', 'Vote time.')),
    updatedAt: dateTimeSchema(bilingual('投票更新时间。', 'Vote update time.')).optional()
  })
  .describe(bilingual('评论投票。', 'Comment vote.'));

export const commentSchema = z
  .object({
    _id: z
      .union([z.string(), objectIdSchema])
      .optional()
      .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: commentIdSchema,
    postId: z.string().optional().describe(bilingual('关联帖子 ID。', 'Associated post ID.')),
    shopId: positiveIntegerString
      .optional()
      .describe(bilingual('关联店铺 ID。', 'Associated shop ID.')),
    shopDeleteRequestId: z
      .string()
      .optional()
      .describe(bilingual('关联删除申请 ID。', 'Associated delete request ID.')),
    content: z.string().describe(bilingual('评论内容（Markdown）。', 'Comment content in Markdown.')),
    images: z
      .array(imageAssetIdSchema)
      .optional()
      .describe(bilingual('评论图片资源 ID 列表。', 'Comment image asset IDs.')),
    resolvedImages: z
      .array(imageAssetSchema)
      .optional()
      .describe(bilingual('已解析的评论图片资源。', 'Resolved comment image assets.')),
    createdBy: userIdSchema.describe(bilingual('评论作者用户 ID。', 'Comment author user ID.')),
    createdAt: dateTimeSchema(bilingual('评论时间。', 'Comment creation time.')),
    updatedAt: dateTimeSchema(bilingual('评论更新时间。', 'Comment update time.')).optional(),
    parentCommentId: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('父评论 ID。', 'Parent comment ID.')),
    upvotes: z.int().min(0).describe(bilingual('点赞数。', 'Upvote count.')),
    downvotes: z.int().min(0).describe(bilingual('点踩数。', 'Downvote count.')),
    author: userPublicSchema.optional().describe(bilingual('评论作者。', 'Comment author.')),
    vote: commentVoteSchema
      .optional()
      .describe(bilingual('当前用户对评论的投票。', 'Current user vote on the comment.'))
  })
  .describe(bilingual('评论。', 'Comment.'));

export const commentUpdateRequestSchema = z
  .object({
    content: z
      .string()
      .trim()
      .optional()
      .default('')
      .describe(bilingual('评论内容（Markdown）。', 'Comment content in Markdown.')),
    images: z
      .array(imageAssetIdSchema)
      .optional()
      .default([])
      .describe(bilingual('评论图片资源 ID 列表。', 'Comment image asset IDs.'))
  })
  .refine((value) => value.content.length > 0 || value.images.length > 0, {
    message: 'Comment content or images are required'
  });

export const commentUpdateResponseSchema = successResponseSchema;

export const commentVoteRequestSchema = z.object({
  voteType: commentVoteTypeSchema
});

export const commentVoteResponseSchema = successResponseSchema.extend({
  upvotes: z.int().min(0).describe(bilingual('点赞数。', 'Upvote count.')),
  downvotes: z.int().min(0).describe(bilingual('点踩数。', 'Downvote count.')),
  userVote: commentVoteTypeSchema
    .nullable()
    .describe(bilingual('当前用户的投票。', 'Current user vote.'))
});

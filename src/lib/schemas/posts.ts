import { z } from 'zod';

import { commentSchema } from './comments';
import {
  bilingual,
  dateTimeSchema,
  objectIdSchema,
  successResponseSchema,
  userIdSchema,
  userPublicSchema
} from './common';
import { imageAssetIdSchema, imageAssetSchema } from './images';

export const postIdSchema = z.string().describe(bilingual('帖子 ID。', 'Post ID.'));

export const postIdParamSchema = z.object({
  postId: postIdSchema
});

export const postReadabilitySchema = z
  .union([z.literal(0), z.literal(1), z.literal(2)])
  .describe(
    bilingual(
      '帖子可见性：0 为公开，1 为大学成员可见，2 为社团成员可见。',
      'Post readability: 0 for public, 1 for university members, and 2 for club members.'
    )
  )
  .meta({ override: { type: 'integer', enum: [0, 1, 2] } });

export const postWritabilitySchema = z
  .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
  .describe(
    bilingual(
      '帖子发布权限：0 为公开，1 为大学成员，2 为社团成员，3 为管理员与版主。',
      'Post writability: 0 for public, 1 for university members, 2 for club members, and 3 for admins and moderators.'
    )
  )
  .meta({ override: { type: 'integer', enum: [0, 1, 2, 3] } });

export const postVoteTypeSchema = z
  .enum(['upvote', 'downvote'])
  .describe(bilingual('帖子投票类型。', 'Post vote type.'));

export const postVoteSchema = z
  .object({
    _id: z
      .union([z.string(), objectIdSchema])
      .optional()
      .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: z.string().describe(bilingual('帖子投票 ID。', 'Post vote ID.')),
    postId: postIdSchema,
    userId: userIdSchema.describe(bilingual('投票用户 ID。', 'Voting user ID.')),
    voteType: postVoteTypeSchema,
    createdAt: dateTimeSchema(bilingual('投票时间。', 'Vote time.')),
    updatedAt: dateTimeSchema(bilingual('投票更新时间。', 'Vote update time.')).optional()
  })
  .describe(bilingual('帖子投票。', 'Post vote.'));

export const postSchema = z
  .object({
    _id: z
      .union([z.string(), objectIdSchema])
      .optional()
      .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: postIdSchema,
    title: z.string().describe(bilingual('帖子标题。', 'Post title.')),
    content: z.string().describe(bilingual('帖子内容（Markdown）。', 'Post content in Markdown.')),
    images: z
      .array(imageAssetIdSchema)
      .optional()
      .describe(bilingual('帖子图片资源 ID 列表。', 'Post image asset IDs.')),
    resolvedImages: z
      .array(imageAssetSchema)
      .optional()
      .describe(bilingual('已解析的帖子图片资源。', 'Resolved post image assets.')),
    universityId: z.string().optional().describe(bilingual('大学 ID。', 'University ID.')),
    clubId: z.string().optional().describe(bilingual('社团 ID。', 'Club ID.')),
    createdBy: userIdSchema.describe(bilingual('作者用户 ID。', 'Author user ID.')),
    createdAt: dateTimeSchema(bilingual('创建时间。', 'Creation time.')),
    updatedAt: dateTimeSchema(bilingual('更新时间。', 'Update time.')).optional(),
    upvotes: z.int().min(0).describe(bilingual('点赞数。', 'Upvote count.')),
    downvotes: z.int().min(0).describe(bilingual('点踩数。', 'Downvote count.')),
    commentCount: z.int().min(0).describe(bilingual('评论数。', 'Comment count.')),
    isPinned: z.boolean().describe(bilingual('是否置顶。', 'Whether the post is pinned.')),
    isLocked: z.boolean().describe(bilingual('是否锁定互动。', 'Whether interactions are locked.')),
    readability: postReadabilitySchema
  })
  .describe(bilingual('帖子。', 'Post.'));

export const postWithAuthorSchema = postSchema.extend({
  author: userPublicSchema.optional().describe(bilingual('作者信息。', 'Author summary.'))
});

export const organizationPostsQuerySchema = z.object({
  page: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
      const parsed = value === null || value === undefined || value === '' ? 1 : Number(value);
      return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 1;
    })
    .describe(bilingual('页数。默认为 1。', 'Page number. Defaults to 1.'))
});

export const organizationPostsResponseSchema = z.object({
  posts: z.array(postWithAuthorSchema).describe(bilingual('帖子列表。', 'Post list.')),
  hasMore: z.boolean().describe(bilingual('是否还有更多帖子。', 'Whether more posts exist.')),
  page: z.int().min(1).describe(bilingual('当前页。', 'Current page.'))
});

export const postDetailResponseSchema = z.object({
  post: postWithAuthorSchema.describe(bilingual('帖子详情。', 'Post details.')),
  comments: z.array(commentSchema).describe(bilingual('评论列表。', 'Comment list.')),
  userVote: postVoteTypeSchema
    .nullable()
    .describe(bilingual('当前用户对帖子的投票。', 'Current user vote on the post.'))
});

export const postCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1).describe(bilingual('帖子标题。', 'Post title.')),
    content: z
      .string()
      .trim()
      .optional()
      .default('')
      .describe(bilingual('帖子内容（Markdown）。', 'Post content in Markdown.')),
    readability: postReadabilitySchema.optional(),
    images: z
      .array(imageAssetIdSchema)
      .optional()
      .default([])
      .describe(bilingual('帖子图片资源 ID 列表。', 'Post image asset IDs.'))
  })
  .refine((value) => value.content.length > 0 || value.images.length > 0, {
    message: 'Post content or images are required'
  });

export const postCreateResponseSchema = successResponseSchema.extend({
  postId: postIdSchema.describe(bilingual('新帖子 ID。', 'New post ID.'))
});

export const postUpdateRequestSchema = z.object({
  title: z.string().trim().optional().describe(bilingual('帖子标题。', 'Post title.')),
  content: z
    .string()
    .trim()
    .optional()
    .describe(bilingual('帖子内容（Markdown）。', 'Post content in Markdown.')),
  readability: postReadabilitySchema.optional(),
  isPinned: z.boolean().optional().describe(bilingual('是否置顶。', 'Whether the post is pinned.')),
  isLocked: z
    .boolean()
    .optional()
    .describe(bilingual('是否锁定互动。', 'Whether interactions are locked.')),
  images: z
    .array(imageAssetIdSchema)
    .optional()
    .describe(bilingual('帖子图片资源 ID 列表。', 'Post image asset IDs.'))
});

export const postUpdateResponseSchema = successResponseSchema;

export const postDeleteResponseSchema = successResponseSchema;

export const postVoteRequestSchema = z.object({
  voteType: postVoteTypeSchema
});

export const postVoteResponseSchema = successResponseSchema.extend({
  upvotes: z.int().min(0).describe(bilingual('点赞数。', 'Upvote count.')),
  downvotes: z.int().min(0).describe(bilingual('点踩数。', 'Downvote count.')),
  userVote: postVoteTypeSchema
    .nullable()
    .describe(bilingual('当前用户的投票。', 'Current user vote.'))
});

export const postCommentCreateRequestSchema = z
  .object({
    content: z
      .string()
      .trim()
      .optional()
      .default('')
      .describe(bilingual('评论内容（Markdown）。', 'Comment content in Markdown.')),
    parentCommentId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(bilingual('父评论 ID。', 'Parent comment ID.')),
    images: z
      .array(imageAssetIdSchema)
      .optional()
      .default([])
      .describe(bilingual('评论图片资源 ID 列表。', 'Comment image asset IDs.'))
  })
  .refine((value) => value.content.length > 0 || value.images.length > 0, {
    message: 'Comment content or images are required'
  });

export const postCommentCreateResponseSchema = successResponseSchema.extend({
  commentId: z.string().describe(bilingual('新评论 ID。', 'New comment ID.'))
});

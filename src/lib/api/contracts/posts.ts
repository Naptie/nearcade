import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual } from '$lib/schemas/common';
import {
  postCommentCreateRequestSchema,
  postCommentCreateResponseSchema,
  postDeleteResponseSchema,
  postDetailResponseSchema,
  postIdSchema,
  postUpdateRequestSchema,
  postUpdateResponseSchema,
  postVoteRequestSchema,
  postVoteResponseSchema
} from '$lib/schemas/posts';

export const postsContract = {
  /** `GET /api/posts/{postId}` — a post with its comments and the caller's vote. */
  detail: definePublic({
    method: 'GET',
    path: '/posts/{postId}',
    operationId: 'getPostsByPostId',
    tags: ['posts'],
    scope: 'open',
    summary: bilingual('获取帖子详情。', 'Get post details.', true),
    description: bilingual(
      '获取帖子详情、评论列表，以及当前用户对帖子的投票状态。',
      'Get a post with its comments and the current user vote on the post.'
    )
  })
    .input(z.object({ postId: postIdSchema }))
    .output(postDetailResponseSchema),

  /** `PUT /api/posts/{postId}` — edit a post or manage its pin/lock state. */
  update: definePublic({
    method: 'PUT',
    path: '/posts/{postId}',
    operationId: 'putPostsByPostId',
    tags: ['posts'],
    scope: 'write:posts',
    guard: 'session',
    summary: bilingual('更新帖子。', 'Update post.', true),
    description: bilingual(
      '更新帖子内容、图片、可见性，或管理置顶与锁定状态。',
      'Update post content, images, readability, or manage pin and lock state.'
    )
  })
    .input(postUpdateRequestSchema.extend({ postId: postIdSchema }))
    .output(postUpdateResponseSchema),

  /** `DELETE /api/posts/{postId}` — delete a post and everything attached to it. */
  remove: definePublic({
    method: 'DELETE',
    path: '/posts/{postId}',
    operationId: 'deletePostsByPostId',
    tags: ['posts'],
    scope: 'write:posts',
    guard: 'session',
    summary: bilingual('删除帖子。', 'Delete post.', true),
    description: bilingual(
      '删除帖子及其关联评论与投票。',
      'Delete a post and its related comments and votes.'
    )
  })
    .input(z.object({ postId: postIdSchema }))
    .output(postDeleteResponseSchema),

  /** `POST /api/posts/{postId}/comments` — comment on a post or reply to a comment. */
  comment: definePublic({
    method: 'POST',
    path: '/posts/{postId}/comments',
    operationId: 'postPostsByPostIdComments',
    tags: ['posts'],
    scope: 'write:comments',
    guard: 'session',
    successStatus: 201,
    summary: bilingual('发表评论到帖子。', 'Post a comment.', true),
    description: bilingual(
      '向帖子发表评论或回复，可附带图片。',
      'Add a comment or reply to a post, optionally with images.'
    )
  })
    .input(postCommentCreateRequestSchema.extend({ postId: postIdSchema }))
    .output(postCommentCreateResponseSchema),

  /** `POST /api/posts/{postId}/vote` — upvote or downvote a post. */
  vote: definePublic({
    method: 'POST',
    path: '/posts/{postId}/vote',
    operationId: 'postPostsByPostIdVote',
    tags: ['posts'],
    scope: 'write:posts',
    guard: 'session',
    summary: bilingual('为帖子投票。', 'Vote on a post.', true),
    description: bilingual(
      '对帖子点赞或点踩；重复提交相同投票会撤销该投票。',
      'Upvote or downvote a post. Sending the same vote twice removes the existing vote.'
    )
  })
    .input(postVoteRequestSchema.extend({ postId: postIdSchema }))
    .output(postVoteResponseSchema)
};

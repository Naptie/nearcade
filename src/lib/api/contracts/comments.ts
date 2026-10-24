import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual, successResponseSchema } from '$lib/schemas/common';
import {
  commentIdSchema,
  commentUpdateRequestSchema,
  commentVoteRequestSchema,
  commentVoteResponseSchema
} from '$lib/schemas/comments';

export const commentsContract = {
  /** `PUT /api/comments/{commentId}` — edit the current user's own comment. */
  update: definePublic({
    method: 'PUT',
    path: '/comments/{commentId}',
    operationId: 'putCommentsByCommentId',
    tags: ['comments'],
    scope: 'write:comments',
    guard: 'session',
    summary: bilingual('更新评论。', 'Update a comment.', true),
    description: bilingual(
      '更新当前用户自己的评论内容和附图。',
      "Update the current user's own comment content and attached images."
    )
  })
    .input(commentUpdateRequestSchema.extend({ commentId: commentIdSchema }))
    .output(successResponseSchema),

  /** `DELETE /api/comments/{commentId}` — delete a comment and its replies. */
  remove: definePublic({
    method: 'DELETE',
    path: '/comments/{commentId}',
    operationId: 'deleteCommentsByCommentId',
    tags: ['comments'],
    scope: 'write:comments',
    guard: 'session',
    summary: bilingual('删除评论。', 'Delete a comment.', true),
    description: bilingual(
      '删除指定评论及其直接回复，并清理关联图片与投票。',
      'Delete a comment together with its direct replies, and clean up related images and votes.'
    )
  })
    .input(z.object({ commentId: commentIdSchema }))
    .output(successResponseSchema),

  /** `POST /api/comments/{commentId}/vote` — upvote or downvote a comment. */
  vote: definePublic({
    method: 'POST',
    path: '/comments/{commentId}/vote',
    operationId: 'postCommentsByCommentIdVote',
    tags: ['comments'],
    scope: 'write:comments',
    guard: 'session',
    summary: bilingual('对评论投票。', 'Vote on a comment.', true),
    description: bilingual(
      '对评论投赞成或反对票；重复提交相同投票会撤销该投票。',
      'Cast an upvote or downvote on a comment. Sending the same vote twice removes the existing vote.'
    )
  })
    .input(commentVoteRequestSchema.extend({ commentId: commentIdSchema }))
    .output(commentVoteResponseSchema)
};

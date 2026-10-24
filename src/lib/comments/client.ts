import { invalidateAll } from '$app/navigation';
import { orpc } from '$lib/api/client';

/**
 * The comment API, as the browser uses it.
 *
 * A comment can be voted on, edited and deleted from three different places —
 * a post, a shop and a delete request — and all three did the same three
 * calls. The calls live here so the contract is named in one place; what a
 * component does with a failure stays with the component, because the three
 * report it differently.
 */

/** Vote a comment up or down. */
export const voteComment = async (
  commentId: string,
  voteType: 'upvote' | 'downvote'
): Promise<void> => {
  await orpc.comments.vote({ commentId, voteType });
  await invalidateAll();
};

/** Replace the text and the images of a comment. */
export const updateComment = async (
  commentId: string,
  content: string,
  images: string[]
): Promise<void> => {
  await orpc.comments.update({ commentId, content, images });
  await invalidateAll();
};

/** Delete a comment. */
export const removeComment = async (commentId: string): Promise<void> => {
  await orpc.comments.remove({ commentId });
  await invalidateAll();
};

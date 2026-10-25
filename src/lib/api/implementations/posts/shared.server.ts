/**
 * Plumbing shared by the post implementations.
 *
 * The procedures bind against the full `postsContract`, so every group needs
 * the same bound `implement()` and the same helpers; they live here so a
 * group only carries the code that is actually about its route.
 */
import { implement } from '@orpc/server';
import type { PostAccessDecision } from '$lib/utils/posts/permissions.server';
import { apiError } from '../../errors';
import { assertImagesExist } from '../../helpers';
import { postsContract } from '../../contracts/posts';
import type { ApiContext } from '../../context';

export const impl = implement(postsContract).$context<ApiContext>();

export { assertImagesExist };

/**
 * Turn a denied post-access decision into the 403 the endpoint answers with.
 *
 * The decision already carries the message, because the rule that produced it
 * — readable, writable, or merely frozen — is the rule that knows what the
 * caller should be told.
 */
export const assertPostAccess = (decision: PostAccessDecision): void => {
  if (decision.allowed) return;
  apiError('FORBIDDEN', decision.message);
};

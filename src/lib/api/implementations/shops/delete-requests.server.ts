/**
 * Shop delete requests: open one for a whole shop or a single photo, list
 * and read them, review them, retract or delete them, comment on them, and
 * vote.
 *
 * The procedures live in the `delete-requests-*` modules beside this file; this
 * module only assembles them, so the group can grow without the file that
 * composes it growing with it.
 */

import { shopsDeleteRequestsCommentsImplementation } from './delete-requests-comments.server';
import { shopsDeleteRequestsCreateImplementation } from './delete-requests-create.server';
import { shopsDeleteRequestsListImplementation } from './delete-requests-list.server';
import { shopsDeleteRequestsReviewImplementation } from './delete-requests-review.server';
import { shopsDeleteRequestsVoteImplementation } from './delete-requests-vote.server';

export const shopsDeleteRequestsImplementation = {
  ...shopsDeleteRequestsCreateImplementation,
  ...shopsDeleteRequestsListImplementation,
  ...shopsDeleteRequestsReviewImplementation,
  ...shopsDeleteRequestsCommentsImplementation,
  ...shopsDeleteRequestsVoteImplementation
};

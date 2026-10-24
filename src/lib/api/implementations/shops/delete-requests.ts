/**
 * Shop delete requests: open one for a whole shop or a single photo, list
 * and read them, review them, retract or delete them, comment on them, and
 * vote.
 *
 * The procedures live in the `delete-requests-*` modules beside this file; this
 * module only assembles them, so the group can grow without the file that
 * composes it growing with it.
 */

import { shopsDeleteRequestsCommentsImplementation } from './delete-requests-comments';
import { shopsDeleteRequestsCreateImplementation } from './delete-requests-create';
import { shopsDeleteRequestsListImplementation } from './delete-requests-list';
import { shopsDeleteRequestsReviewImplementation } from './delete-requests-review';
import { shopsDeleteRequestsVoteImplementation } from './delete-requests-vote';

export const shopsDeleteRequestsImplementation = {
  ...shopsDeleteRequestsCreateImplementation,
  ...shopsDeleteRequestsListImplementation,
  ...shopsDeleteRequestsReviewImplementation,
  ...shopsDeleteRequestsCommentsImplementation,
  ...shopsDeleteRequestsVoteImplementation
};

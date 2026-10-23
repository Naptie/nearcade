/**
 * The posts of a university: the feed the university's page shows, and the
 * creation of a new post in it.
 *
 * Both procedures are the organisation-post domain — the readability rules
 * and the writability rules live in `$lib/utils/organizations/posts.server`,
 * which the club endpoints use as well. What stays here is the translation
 * of a domain failure into the status this endpoint answers with.
 */
import { implement } from '@orpc/server';
import { universitiesContract } from '../../contracts/universities';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError } from '../../errors';
import { toPlainWire } from '../../wire.server';
import { m } from '$lib/paraglide/messages';

import { organizationPostsResponseSchema } from '$lib/schemas/posts';
import {
  createOrganizationPost,
  listOrganizationPosts,
  OrganizationPostError
} from '$lib/utils/organizations/posts.server';

const impl = implement(universitiesContract).$context<ApiContext>();

export const universitiesPostsImplementation = {
  posts: impl.posts.handler(async ({ input, context }) => {
    try {
      const session = context.session;
      const { id: universityId, page } = input;

      const { posts, hasMore } = await listOrganizationPosts({
        kind: 'university',
        id: universityId,
        page,
        viewer: session?.user
      });

      return toPlainWire(organizationPostsResponseSchema, {
        posts,
        hasMore,
        page
      });
    } catch (err) {
      if (err instanceof OrganizationPostError) {
        apiError(err.code, err.message);
      }
      rethrowApiError(err, m.internal_server_error());
    }
  }),

  createPost: impl.createPost.handler(async ({ input, context }) => {
    try {
      const session = context.session;
      if (!session?.user?.id) {
        apiError('UNAUTHORIZED', m.unauthorized());
      }

      const { id: universityId } = input;

      const { postId } = await createOrganizationPost({
        kind: 'university',
        id: universityId,
        user: session.user,
        input: {
          title: input.title,
          content: input.content,
          readability: input.readability,
          images: input.images
        }
      });

      return { success: true, postId };
    } catch (err) {
      if (err instanceof OrganizationPostError) {
        apiError(err.code, err.message);
      }
      rethrowApiError(err, m.internal_server_error());
    }
  })
};

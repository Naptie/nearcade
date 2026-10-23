/**
 * The profile endpoints: the profile of an addressed user and the profile of
 * the signed-in user.
 *
 * Both answer with the same payload — the payload the shared builder
 * assembles — and differ only in who is asking: the addressed endpoint
 * respects the privacy flags of the profile owner, the signed-in one shows
 * everything the user owns.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import type { User } from '$lib/auth/types';
import { m } from '$lib/paraglide/messages';
import { userProfileResponseSchema } from '$lib/schemas/users';
import { buildUserProfile } from '$lib/utils/user-profile.server';
import { usersContract } from '../../contracts/users';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError, toWire } from '../../errors';
import { findUserByRouteId } from './shared';

const impl = implement(usersContract).$context<ApiContext>();

export const usersProfileImplementation = {
  /** `GET /api/users/{id}` */
  profile: impl.profile.handler(async ({ input, context }) => {
    const session = context.session;
    const { id } = input;

    try {
      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      const user = await findUserByRouteId(usersCollection, id);

      const canViewAll = session?.user?.id === user.id || session?.user?.userType === 'site_admin';

      return toWire(
        userProfileResponseSchema,
        await buildUserProfile(db, user, {
          canViewAll,
          isOwnProfile: session?.user?.id === user.id
        })
      );
    } catch (err) {
      rethrowApiError(err, m.failed_to_load_user_profile());
    }
  }),

  /** `GET /api/users/me` */
  me: impl.me.handler(async ({ context }) => {
    const userId = context.session?.user?.id;

    if (!userId) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    try {
      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      // The session already carries the id, so the document is looked up by it
      // — the `@username` spelling belongs to the route, not to a session.
      const user = await usersCollection.findOne({ id: userId });

      if (!user) {
        apiError('NOT_FOUND', m.user_not_found());
      }

      // Always show all data since this is the user's own profile
      return toWire(
        userProfileResponseSchema,
        await buildUserProfile(db, user, { canViewAll: true, isOwnProfile: true })
      );
    } catch (err) {
      rethrowApiError(err, m.failed_to_load_user_profile());
    }
  })
};

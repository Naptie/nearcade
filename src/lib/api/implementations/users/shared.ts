/**
 * The user lookup shared by the user procedures.
 *
 * A route id is either the user id or the username prefixed with `@`, so the
 * two spellings resolve to the same document.
 */
import type { Collection } from 'mongodb';
import type { User } from '$lib/auth/types';
import { m } from '$lib/paraglide/messages';
import { apiError } from '../../errors';

export const findUserByRouteId = async (
  usersCollection: Collection<User>,
  id: string
): Promise<User> => {
  const user = id.startsWith('@')
    ? await usersCollection.findOne({ name: id.slice(1) })
    : await usersCollection.findOne({ id });

  if (!user) {
    apiError('NOT_FOUND', m.user_not_found());
  }

  return user;
};

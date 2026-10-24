/**
 * The administrative user lookup: resolve a bound social account to the
 * accounts that carry it.
 *
 * The procedure admits three credentials — the shared service secret, a machine
 * secret bound to a shop, and a site administrator — because resolving a
 * social account to an account is an administrative lookup, not a delegated
 * one.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import type { User } from '$lib/auth/types';
import { m } from '$lib/paraglide/messages';
import { usersLookupResponseSchema } from '$lib/schemas/users';
import { protect, toPlainArray } from '$lib/utils';
import { API_TOKEN_PREFIX } from '$lib/api-tokens';
import { validateMachineAuth } from '$lib/utils/machine.server';
import { SSC_SECRET } from '$env/static/private';
import { usersContract } from '../../contracts/users';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError } from '../../errors';
import { toPlainWire } from '../../wire.server';

const impl = implement(usersContract).$context<ApiContext>();

export const usersLookupImplementation = {
  lookup: impl.lookup.handler(async ({ input, context }) => {
    // --- Auth: SSC_SECRET (raw or Bearer) ---
    const authHeader = context.event.request.headers.get('Authorization');
    if (authHeader === SSC_SECRET || authHeader === `Bearer ${SSC_SECRET}`) {
      // Allow (service key)
    }
    // --- Auth: machine secret (requires matching shopId) ---
    else if (authHeader?.startsWith(`Bearer ${API_TOKEN_PREFIX}`)) {
      if (input.shopId === undefined) {
        apiError('BAD_REQUEST', m.missing_required_fields());
      }
      // throws 401/403 internally
      await validateMachineAuth(context.event.request, input.shopId!);
    }
    // --- Auth: site admin session ---
    else if (context.session?.user?.userType === 'site_admin') {
      // Allow
    } else {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    // --- Query: match any provided social account (platform + username) ---
    // A social account is not guaranteed to map to a single user (e.g. the same
    // QQ may be bound by several accounts), so all matches are returned and the
    // caller decides which one to use.
    const socialFilters: Array<{ platform: string; username: string }> = [];
    if (input.qq !== undefined) {
      socialFilters.push({ platform: 'qq', username: input.qq });
    }
    // Future lookup modes (e.g. WeChat ID) add a branch here:
    // if (input.wechat !== undefined) socialFilters.push({ platform: 'wechat', username: input.wechat });

    if (socialFilters.length === 0) {
      apiError('BAD_REQUEST', m.missing_required_fields());
    }

    try {
      const db = mongo.db();
      const usersCollection = db.collection<User>('users');
      const users = await usersCollection
        .find({
          $or: socialFilters.map((f) => ({ socialLinks: { $elemMatch: f } }))
        })
        .toArray();

      const protectedUsers = users
        .map((user) => protect(user))
        .filter((user): user is NonNullable<typeof user> => user !== undefined);

      return toPlainWire(usersLookupResponseSchema, { users: toPlainArray(protectedUsers) });
    } catch (err) {
      rethrowApiError(err, m.failed_to_load_user_profile());
    }
  })
};

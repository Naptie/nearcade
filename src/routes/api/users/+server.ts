import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { User } from '$lib/auth/types';
import mongo from '$lib/db/index.server';
import { protect, toPlainArray, toPlainObject } from '$lib/utils';
import { MACHINE_API_SECRET_PREFIX, validateMachineAuth } from '$lib/utils/machine.server';
import { SSC_SECRET } from '$env/static/private';
import { m } from '$lib/paraglide/messages';
import { usersLookupQuerySchema, usersLookupResponseSchema } from '$lib/schemas/users';
import { parseQueryOrError } from '$lib/utils/validation.server';

export const GET: RequestHandler = async ({ url, locals, request }) => {
  try {
    const query = parseQueryOrError(usersLookupQuerySchema, url);

    // --- Auth: SSC_SECRET (raw or Bearer) ---
    const authHeader = request.headers.get('Authorization');
    if (authHeader === SSC_SECRET || authHeader === `Bearer ${SSC_SECRET}`) {
      // Allow (service key)
    }
    // --- Auth: machine secret (requires matching shopId) ---
    else if (authHeader?.startsWith(`Bearer ${MACHINE_API_SECRET_PREFIX}`)) {
      if (query.shopId === undefined) {
        error(400, m.missing_required_fields());
      }
      await validateMachineAuth(request, query.shopId); // throws 401/403 internally
    }
    // --- Auth: site admin session ---
    else if (locals.session?.user?.userType === 'site_admin') {
      // Allow
    } else {
      error(401, m.unauthorized());
    }

    // --- Query: match any provided social account (platform + username) ---
    // A social account is not guaranteed to map to a single user (e.g. the same
    // QQ may be bound by several accounts), so all matches are returned and the
    // caller decides which one to use.
    const socialFilters: Array<{ platform: string; username: string }> = [];
    if (query.qq !== undefined) {
      socialFilters.push({ platform: 'qq', username: query.qq });
    }
    // Future lookup modes (e.g. WeChat ID) add a branch here:
    // if (query.wechat !== undefined) socialFilters.push({ platform: 'wechat', username: query.wechat });

    if (socialFilters.length === 0) {
      error(400, m.missing_required_fields());
    }

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

    return json(
      usersLookupResponseSchema.parse(toPlainObject({ users: toPlainArray(protectedUsers) }))
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) throw err;
    console.error('Error looking up users:', err);
    error(500, m.failed_to_load_user_profile());
  }
};

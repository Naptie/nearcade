/**
 * Who is behind an attendance request, and which shop it is about.
 *
 * The attendance writes answer to two very different callers — a signed-in
 * user and an agent API key — and the shop a request refers to is either
 * open to anybody or reserved for the agent key bound to it. Both decisions
 * are shared by every write, so they are resolved here.
 */

import mongo from '$lib/db/index.server';
import { auth } from '$lib/auth/index.server';
import type { User } from '$lib/auth/types';
import { m } from '$lib/paraglide/messages';
import type { Shop } from '$lib/types';
import { getShopOpeningHours } from '$lib/utils';
import { requireBoundPhone } from '$lib/utils/index.server';
import { apiError } from '../../errors';
import type { ApiContext } from '../../context';

/**
 * Who is behind an attendance request.
 *
 * The attendance endpoint answers to two very different callers: a signed-in
 * user registering their own presence, and an agent API key reporting on
 * behalf of a shop — optionally on behalf of a named user, through the
 * composite `agent/user` credential.
 */
export type AttendanceCaller = {
  /** The user the request acts as. */
  user: User;
  /** The user whose presence is registered, when it is not the caller. */
  attendingUser: User | null;
  /** Whether the caller is an agent API key rather than a session. */
  isOpenApiAccess: boolean;
  /** Whether the agent key is bound to a shop. */
  isClaimedShopAccess: boolean;
  /** Whether the request registers another user's presence. */
  isAttendingOnBehalf: boolean;
  /**
   * The scopes granted to the OAuth token that authorized the call.
   *
   * `null` means the call did not use an OAuth token — a first-party session
   * cookie, an `nk_` API key or `SSC_SECRET`. Those bypass the OAuth scope
   * matrix by design, so no scope is demanded of them.
   */
  oauthScopes: string[] | null;
};

/**
 * Require a scope of an OAuth access token.
 *
 * The scope matrix only ever applies to third-party clients, so a call that
 * did not arrive with an OAuth token is not asked for one.
 */
export const requireScope = (caller: AttendanceCaller, scope: string) => {
  if (caller.oauthScopes && !caller.oauthScopes.includes(scope)) {
    apiError('FORBIDDEN', m.access_denied());
  }
};

/**
 * Resolve the caller behind an attendance request.
 *
 * The agent credential may be a composite `agent/user` pair that no session
 * resolver can read, so it is resolved here rather than by the guard.
 */
export const resolveAttendanceCaller = async (
  input: { id: number },
  context: ApiContext
): Promise<AttendanceCaller> => {
  const session = context.session;
  let user = session?.user;
  let attendingUser: User | null = null;
  let isOpenApiAccess = false;
  let isClaimedShopAccess = false;
  let isAttendingOnBehalf = false;

  if (!user) {
    const header = context.event.request.headers.get('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      apiError('UNAUTHORIZED');
    }
    const token = header.slice(7);
    const agentToken = token.split('/')[0];
    const userToken = token === agentToken ? null : token.split('/')[1];
    const db = mongo.db();
    const usersCollection = db.collection<User>('users');
    const agentApiKey = await auth.api.verifyApiKey({
      body: { key: agentToken }
    });
    if (!agentApiKey.valid || !agentApiKey.key) {
      apiError('UNAUTHORIZED');
    }
    const agentShopId = agentApiKey.key.metadata?.shopId;
    if (agentShopId && agentShopId.toString() !== String(input.id)) {
      apiError('FORBIDDEN', m.access_denied());
    }
    const dbUser = await usersCollection.findOne({ id: agentApiKey.key.referenceId });
    if (!dbUser) {
      apiError('UNAUTHORIZED');
    }
    isOpenApiAccess = true;
    isClaimedShopAccess = !!agentShopId;
    user = dbUser;
    if (userToken) {
      const targetApiKey = await auth.api.verifyApiKey({
        body: { key: userToken }
      });
      if (!targetApiKey.valid || !targetApiKey.key) {
        apiError('NOT_FOUND', m.target_user_not_found());
      }
      // A key can outlive the account it points at. Treat that as "the target
      // user does not exist" rather than as "no user was named": falling
      // through to `null` would silently register the agent's own presence.
      const targetUser = await usersCollection.findOne({ id: targetApiKey.key.referenceId });
      if (!targetUser) {
        apiError('NOT_FOUND', m.target_user_not_found());
      }
      attendingUser = targetUser;
      isAttendingOnBehalf = true;
    }
  }

  requireBoundPhone(user);
  if (attendingUser) {
    requireBoundPhone(attendingUser);
  }

  return {
    user: user!,
    attendingUser,
    isOpenApiAccess,
    isClaimedShopAccess,
    isAttendingOnBehalf,
    oauthScopes: context.oauthScopes
  };
};

/**
 * The shop and the games an attendance request refers to.
 *
 * A shop that is claimed belongs to its machine's owner: only the agent key
 * bound to that shop may report for it. An unclaimed shop may be reported for
 * by anyone who is signed in.
 */
export type AttendanceTarget = {
  shop: Shop;
  /** The shop's own games that the request mentions. */
  shopGames: { gameId: number }[];
  now: number;
  openTolerated: Date;
  closeTolerated: Date;
};

export const resolveAttendanceTarget = async (
  input: { id: number },
  gameIds: number[],
  caller: AttendanceCaller
): Promise<AttendanceTarget> => {
  const db = mongo.db();
  const shopsCollection = db.collection<Shop>('shops');
  const shop = await shopsCollection.findOne({ id: input.id });
  if (!shop) {
    apiError('NOT_FOUND', m.shop_not_found());
  }
  if (
    (caller.isClaimedShopAccess && !shop.isClaimed) ||
    (!caller.isClaimedShopAccess && shop.isClaimed)
  ) {
    apiError('FORBIDDEN', m.access_denied());
  }

  const shopGames = shop.games.filter((sg) => gameIds.includes(sg.gameId));
  if (shopGames.length !== gameIds.length) {
    apiError('NOT_FOUND', m.games_missing_in_shop());
  }

  const now = Date.now();
  if (shop.isClosed) {
    apiError('BAD_REQUEST', m.shop_is_permanently_closed());
  }
  const { openTolerated, closeTolerated } = getShopOpeningHours(shop);
  if (now < openTolerated.getTime() || now > closeTolerated.getTime()) {
    apiError('BAD_REQUEST', m.shop_is_currently_closed());
  }

  return { shop, shopGames, now, openTolerated, closeTolerated };
};

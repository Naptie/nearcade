import { implement } from '@orpc/server';
import { contractRouter } from './contracts';
import { adminImplementation } from './implementations/admin';
import { announcementsImplementation } from './implementations/announcements';
import { clubsImplementation } from './implementations/clubs';
import { commentsImplementation } from './implementations/comments';
import { discoverImplementation } from './implementations/discover';
import { gameTitlesImplementation } from './implementations/game-titles';
import { geoImplementation } from './implementations/geo';
import { globeImplementation } from './implementations/globe';
import { homeImplementation } from './implementations/home';
import { imagesImplementation } from './implementations/images';
import { invitesImplementation } from './implementations/invites';
import { machinesImplementation } from './implementations/machines';
import { meilisearchImplementation } from './implementations/meilisearch';
import { notificationsImplementation } from './implementations/notifications';
import { phoneImplementation } from './implementations/phone';
import { postsImplementation } from './implementations/posts';
import { qbindImplementation } from './implementations/qbind';
import { rankingsImplementation } from './implementations/rankings';
import { redirectImplementation } from './implementations/redirect';
import { regionsImplementation } from './implementations/regions';
import { shopsImplementation } from './implementations/shops';
import { ugcImplementation } from './implementations/ugc';
import { universitiesImplementation } from './implementations/universities';
import { usersImplementation } from './implementations/users';
import { wechatImplementation } from './implementations/wechat';
import { enforceOAuthScope } from './middleware/scope';
import { preserveHttpErrorStatus } from './middleware/http-error';
import { enforceAuthGuard } from './middleware/auth';
import type { ApiContext } from './context';

/**
 * The application router.
 *
 * `implement(contractRouter)` binds every implementation to its contract: a
 * procedure whose handler returns a shape the output schema rejects is a
 * compile error, and a router that does not match the contract is a compile
 * error too.
 *
 * The middlewares run in this order, all of them *before* the input is
 * validated — which is what keeps the original status codes:
 *
 * 1. `preserveHttpErrorStatus` — a SvelteKit `error()` raised by a shared
 *    helper keeps its status instead of becoming a generic 500.
 * 2. `enforceAuthGuard` — the authorization requirement a procedure declares.
 * 3. `enforceOAuthScope` — the per-procedure OAuth scope, read from the
 *    contract, so the middleware never has to know anything about URL paths.
 */
export const appRouter = implement(contractRouter)
  .$context<ApiContext>()
  .use(preserveHttpErrorStatus)
  .use(enforceAuthGuard)
  .use(enforceOAuthScope)
  .router({
    admin: adminImplementation,
    announcements: announcementsImplementation,
    clubs: clubsImplementation,
    comments: commentsImplementation,
    discover: discoverImplementation,
    gameTitles: gameTitlesImplementation,
    geo: geoImplementation,
    globe: globeImplementation,
    home: homeImplementation,
    images: imagesImplementation,
    invites: invitesImplementation,
    machines: machinesImplementation,
    meilisearch: meilisearchImplementation,
    notifications: notificationsImplementation,
    phone: phoneImplementation,
    posts: postsImplementation,
    qbind: qbindImplementation,
    rankings: rankingsImplementation,
    redirect: redirectImplementation,
    regions: regionsImplementation,
    shops: shopsImplementation,
    ugc: ugcImplementation,
    universities: universitiesImplementation,
    users: usersImplementation,
    wechat: wechatImplementation
  });

export type AppRouter = typeof appRouter;

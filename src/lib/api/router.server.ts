import { implement } from '@orpc/server';
import { contractRouter } from './contracts';
import { adminImplementation } from './implementations/admin.server';
import { announcementsImplementation } from './implementations/announcements.server';
import { clubsImplementation } from './implementations/clubs.server';
import { commentsImplementation } from './implementations/comments.server';
import { discoverImplementation } from './implementations/discover.server';
import { gameTitlesImplementation } from './implementations/game-titles.server';
import { geoImplementation } from './implementations/geo.server';
import { globeImplementation } from './implementations/globe.server';
import { homeImplementation } from './implementations/home.server';
import { imagesImplementation } from './implementations/images.server';
import { invitesImplementation } from './implementations/invites.server';
import { machinesImplementation } from './implementations/machines.server';
import { meilisearchImplementation } from './implementations/meilisearch.server';
import { notificationsImplementation } from './implementations/notifications.server';
import { phoneImplementation } from './implementations/phone.server';
import { postsImplementation } from './implementations/posts.server';
import { qbindImplementation } from './implementations/qbind.server';
import { rankingsImplementation } from './implementations/rankings.server';
import { redirectImplementation } from './implementations/redirect.server';
import { regionsImplementation } from './implementations/regions.server';
import { shopsImplementation } from './implementations/shops/index.server';
import { ugcImplementation } from './implementations/ugc.server';
import { universitiesImplementation } from './implementations/universities.server';
import { usersImplementation } from './implementations/users.server';
import { wechatImplementation } from './implementations/wechat.server';
import { enforceOAuthScope } from './middleware/scope.server';
import { preserveHttpErrorStatus } from './middleware/http-error.server';
import { enforceAuthGuard } from './middleware/auth.server';
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

import { adminContract } from './admin';
import { announcementsContract } from './announcements';
import { clubsContract } from './clubs';
import { commentsContract } from './comments';
import { discoverContract } from './discover';
import { gameTitlesContract } from './game-titles';
import { geoContract } from './geo';
import { globeContract } from './globe';
import { homeContract } from './home';
import { imagesContract } from './images';
import { invitesContract } from './invites';
import { machinesContract } from './machines';
import { meilisearchContract } from './meilisearch';
import { notificationsContract } from './notifications';
import { phoneContract } from './phone';
import { postsContract } from './posts';
import { qbindContract } from './qbind';
import { rankingsContract } from './rankings';
import { redirectContract } from './redirect';
import { regionsContract } from './regions';
import { shopsContract } from './shops';
import { ugcContract } from './ugc';
import { universitiesContract } from './universities';
import { usersContract } from './users';
import { wechatContract } from './wechat';

/**
 * The contract router — the single source of truth for every API endpoint.
 *
 * Only procedures that are actually implemented may appear here; the router
 * assembly in `src/lib/api/router.ts` type-checks each implementation against
 * its contract, so a contract without an implementation is a build error.
 */
export const contractRouter = {
  admin: adminContract,
  announcements: announcementsContract,
  clubs: clubsContract,
  comments: commentsContract,
  discover: discoverContract,
  gameTitles: gameTitlesContract,
  geo: geoContract,
  globe: globeContract,
  home: homeContract,
  images: imagesContract,
  invites: invitesContract,
  machines: machinesContract,
  meilisearch: meilisearchContract,
  notifications: notificationsContract,
  phone: phoneContract,
  posts: postsContract,
  qbind: qbindContract,
  rankings: rankingsContract,
  redirect: redirectContract,
  regions: regionsContract,
  shops: shopsContract,
  ugc: ugcContract,
  universities: universitiesContract,
  users: usersContract,
  wechat: wechatContract
};

export type ContractRouter = typeof contractRouter;

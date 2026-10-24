/**
 * The arcades a club starred, paginated.
 *
 * The page follows the order the club starred them in, so the membership
 * list and the club's own list never disagree.
 */
import { implement } from '@orpc/server';
import { clubsContract } from '../../contracts/clubs';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError, toWire } from '../../errors';
import { toPlainWire } from '../../wire.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toShopApiList } from '$lib/utils/shops/api.server';
import { clubArcadesResponseSchema } from '$lib/schemas/organizations';
import { PAGINATION } from '$lib/constants';
import { type Shop, type ShopApi } from '$lib/types';
import { findClubByRouteId } from './shared';

const impl = implement(clubsContract).$context<ApiContext>();

export const clubsArcadesImplementation = {
  arcades: impl.arcades.handler(async ({ input }) => {
    try {
      const { id: clubId, page } = input;
      const offset = (page - 1) * PAGINATION.PAGE_SIZE;

      const db = mongo.db();
      const shopsCollection = db.collection<Shop>('shops');

      // Get club data
      const club = await findClubByRouteId(clubId);

      if (!club) {
        apiError('NOT_FOUND', m.club_not_found());
      }

      if (!club.starredArcades || club.starredArcades.length === 0) {
        return toWire(clubArcadesResponseSchema, {
          arcades: [],
          hasMore: false,
          page,
          total: 0
        });
      }

      const arcadeIdentifiers = club.starredArcades.filter((arcade) => !isNaN(arcade));

      // Get total count for pagination
      const totalArcades = arcadeIdentifiers.length;
      const hasMore = offset + PAGINATION.PAGE_SIZE < totalArcades;

      // Get the IDs for this page
      const pageArcadeIdentifiers = arcadeIdentifiers.slice(offset, offset + PAGINATION.PAGE_SIZE);

      let arcades: ShopApi[] = [];
      if (pageArcadeIdentifiers.length > 0) {
        const arcadeResults = await shopsCollection
          .find({
            id: { $in: pageArcadeIdentifiers }
          })
          .toArray();

        // Sort arcades to match the order in club.starredArcades
        const arcadeMap = new Map(arcadeResults.map((arcade) => [arcade.id, arcade]));
        arcades = await toShopApiList(
          pageArcadeIdentifiers.map((arcade) => arcadeMap.get(arcade)).filter(Boolean) as Shop[]
        );
      }

      return toPlainWire(clubArcadesResponseSchema, {
        arcades,
        hasMore,
        page,
        total: totalArcades
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_load_club_arcades());
    }
  })
};

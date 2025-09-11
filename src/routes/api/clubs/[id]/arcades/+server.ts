import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import type { Club, Shop } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import client from '$lib/db/index.server';

export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const { id: clubId } = params;
    const page = parseInt(url.searchParams.get('page') || '1');
    const offset = (page - 1) * PAGINATION.PAGE_SIZE;

    const db = client.db();
    const clubsCollection = db.collection<Club>('clubs');
    const shopsCollection = db.collection<Shop>('shops');

    // Get club data
    const club = await clubsCollection.findOne({
      $or: [{ id: clubId }, { slug: clubId }]
    });

    if (!club) {
      return json({ error: 'Club not found' }, { status: 404 });
    }

    if (!club.starredArcades || club.starredArcades.length === 0) {
      return json({
        arcades: [],
        hasMore: false,
        page,
        total: 0
      });
    }

    const arcadeIdentifiers = club.starredArcades.filter((arcade) => !isNaN(arcade.id));

    // Get total count for pagination
    const totalArcades = arcadeIdentifiers.length;
    const hasMore = offset + PAGINATION.PAGE_SIZE < totalArcades;

    // Get the IDs for this page
    const pageArcadeIdentifiers = arcadeIdentifiers.slice(offset, offset + PAGINATION.PAGE_SIZE);

    let arcades: Shop[] = [];
    if (pageArcadeIdentifiers.length > 0) {
      const arcadeResults = await shopsCollection
        .find({
          $and: [
            { id: { $in: pageArcadeIdentifiers.map((arcade) => arcade.id) } },
            { source: { $in: pageArcadeIdentifiers.map((arcade) => arcade.source) } }
          ]
        })
        .toArray();

      // Sort arcades to match the order in club.starredArcades
      const arcadeMap = new Map(
        arcadeResults.map((arcade) => [`${arcade.source}-${arcade.id}`, arcade])
      );
      arcades = toPlainArray(
        pageArcadeIdentifiers
          .map((arcade) => arcadeMap.get(`${arcade.source}-${arcade.id}`))
          .filter(Boolean) as Shop[]
      );
    }

    return json({
      arcades,
      hasMore,
      page,
      total: totalArcades
    });
  } catch (error) {
    console.error('Error loading club arcades:', error);
    return json({ error: 'Failed to load club arcades' }, { status: 500 });
  }
};

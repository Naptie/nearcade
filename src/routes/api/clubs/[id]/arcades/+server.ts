import { MONGODB_URI } from '$env/static/private';
import { MongoClient } from 'mongodb';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import type { Club, Shop } from '$lib/types';
import { toPlainArray } from '$lib/utils';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const { id: clubId } = params;
    const page = parseInt(url.searchParams.get('page') || '1');
    const offset = (page - 1) * PAGINATION.PAGE_SIZE;

    const mongoClient = await clientPromise;
    const db = mongoClient.db();
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

    // Convert string IDs to numbers for shop queries
    const arcadeIds = club.starredArcades
      .map((id: string) => parseInt(id))
      .filter((id: number) => !isNaN(id));

    // Get total count for pagination
    const totalArcades = arcadeIds.length;
    const hasMore = offset + PAGINATION.PAGE_SIZE < totalArcades;

    // Get the IDs for this page
    const pageArcadeIds = arcadeIds.slice(offset, offset + PAGINATION.PAGE_SIZE);

    let arcades: Shop[] = [];
    if (pageArcadeIds.length > 0) {
      const arcadeResults = await shopsCollection.find({ id: { $in: pageArcadeIds } }).toArray();

      // Sort arcades to match the order in club.starredArcades
      const arcadeMap = new Map(arcadeResults.map((arcade) => [arcade.id, arcade]));
      arcades = toPlainArray(
        pageArcadeIds.map((id: number) => arcadeMap.get(id)).filter(Boolean) as Shop[]
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

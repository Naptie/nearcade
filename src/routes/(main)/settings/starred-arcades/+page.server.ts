import { fail } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { MongoClient, type Document } from 'mongodb';
import type { PageServerLoad, Actions } from './$types';
import type { User } from '@auth/sveltekit';
import type { Shop } from '$lib/types';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();

  if (!user) {
    return fail(401, { message: 'Unauthorized' });
  }

  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();
    const usersCollection = db.collection<User>('users');
    const shopsCollection = db.collection<Shop>('shops');

    // Get user profile with starred arcades
    const userProfile = await usersCollection.findOne({ id: user.id });
    const starredArcadeIds = userProfile?.starredArcades || [];

    // Get arcade details if there are any
    let starredArcades: Document[] = [];
    if (starredArcadeIds.length > 0) {
      starredArcades = await shopsCollection.find({ id: { $in: starredArcadeIds } }).toArray();
    }

    return {
      starredArcades: starredArcades.map((arcade) => ({
        id: arcade.id,
        name: arcade.name,
        address: arcade.address || '',
        location: arcade.location,
        games: arcade.games || []
      }))
    };
  } catch (err) {
    console.error('Error loading starred arcades:', err);
    return {
      starredArcades: []
    };
  }
};

export const actions: Actions = {
  addArcade: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const arcadeId = parseInt(formData.get('arcadeId') as string);

      if (!arcadeId) {
        return fail(400, { message: 'Arcade ID is required' });
      }

      const mongoClient = await clientPromise;
      const db = mongoClient.db();
      const usersCollection = db.collection<User>('users');
      const shopsCollection = db.collection<Shop>('shops');

      // Check if arcade exists
      const arcade = await shopsCollection.findOne({ id: arcadeId });
      if (!arcade) {
        return fail(404, { message: 'Arcade not found' });
      }

      // Add arcade to user's starred list
      await usersCollection.updateOne(
        { id: user.id },
        {
          $addToSet: { starredArcades: arcadeId },
          $set: { updatedAt: new Date() }
        },
        { upsert: true }
      );

      return { success: true, message: 'Arcade starred successfully' };
    } catch (err) {
      console.error('Error starring arcade:', err);
      return fail(500, { message: 'Failed to star arcade' });
    }
  },

  removeArcade: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const arcadeId = parseInt(formData.get('arcadeId') as string);

      if (!arcadeId) {
        return fail(400, { message: 'Arcade ID is required' });
      }

      const mongoClient = await clientPromise;
      const db = mongoClient.db();
      const usersCollection = db.collection<User>('users');

      // Remove arcade from user's starred list
      await usersCollection.updateOne({ id: user.id }, {
        $pull: { starredArcades: arcadeId },
        $set: { updatedAt: new Date() }
      } as Document);

      return { success: true, message: 'Arcade unstarred successfully' };
    } catch (err) {
      console.error('Error unstarring arcade:', err);
      return fail(500, { message: 'Failed to unstar arcade' });
    }
  }
};

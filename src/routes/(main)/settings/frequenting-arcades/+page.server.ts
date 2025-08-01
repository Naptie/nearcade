import { fail } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { MongoClient, type Document } from 'mongodb';
import type { PageServerLoad, Actions } from './$types';
import type { Shop } from '$lib/types';
import type { User } from '@auth/sveltekit';

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

    // Get user profile with frequenting arcades
    const userProfile = await usersCollection.findOne({ id: user.id });
    const frequentingArcadeIds = userProfile?.frequentingArcades || [];

    // Get arcade details if there are any
    let frequentingArcades: Shop[] = [];
    if (frequentingArcadeIds.length > 0) {
      frequentingArcades = (await shopsCollection
        .find({ id: { $in: frequentingArcadeIds } })
        .toArray()) as never;
    }

    return {
      frequentingArcades: frequentingArcades.map((arcade) => ({
        id: arcade.id,
        name: arcade.name,
        location: arcade.location,
        games: arcade.games || []
      })),
      autoDiscoveryThreshold: userProfile?.autoDiscoveryThreshold ?? 3
    };
  } catch (err) {
    console.error('Error loading frequenting arcades:', err);
    return {
      frequentingArcades: []
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

      // Add arcade to user's frequenting list
      await usersCollection.updateOne(
        { id: user.id },
        {
          $addToSet: { frequentingArcades: arcadeId },
          $set: { updatedAt: new Date() }
        },
        { upsert: true }
      );

      return { success: true, message: 'Arcade added to your frequenting list' };
    } catch (err) {
      console.error('Error adding arcade:', err);
      return fail(500, { message: 'Failed to add arcade' });
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

      // Remove arcade from user's frequenting list
      await usersCollection.updateOne({ id: user.id }, {
        $pull: { frequentingArcades: arcadeId },
        $set: { updatedAt: new Date() }
      } as Document);

      return { success: true, message: 'Arcade removed from your frequenting list' };
    } catch (err) {
      console.error('Error removing arcade:', err);
      return fail(500, { message: 'Failed to remove arcade' });
    }
  },

  updateSettings: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const threshold = parseInt(formData.get('autoDiscoveryThreshold') as string);

      if (!threshold || threshold < 1 || threshold > 10) {
        return fail(400, { message: 'Auto-discovery threshold must be between 1 and 10' });
      }

      const mongoClient = await clientPromise;
      const db = mongoClient.db();
      const usersCollection = db.collection<User>('users');

      // Update user's auto-discovery threshold
      await usersCollection.updateOne(
        { id: user.id },
        {
          $set: {
            autoDiscoveryThreshold: threshold,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );

      return { success: true, message: 'Settings updated successfully' };
    } catch (err) {
      console.error('Error updating settings:', err);
      return fail(500, { message: 'Failed to update settings' });
    }
  }
};

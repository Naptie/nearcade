import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { User } from '@auth/sveltekit';
import type { Shop } from '$lib/types';
import client from '$lib/db/index.server';
import type { ShopSource } from '$lib/constants';

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();

  if (!user) {
    return fail(401, { message: 'Unauthorized' });
  }

  try {
    const db = client.db();
    const usersCollection = db.collection<User>('users');
    const shopsCollection = db.collection<Shop>('shops');

    // Get user profile with starred arcades
    const userProfile = await usersCollection.findOne({ id: user.id });
    const starredArcadeIdentifiers = userProfile?.starredArcades || [];

    // Get arcade details if there are any
    let starredArcades: Shop[] = [];
    if (starredArcadeIdentifiers.length > 0) {
      starredArcades = await shopsCollection
        .find({
          $and: [
            { id: { $in: starredArcadeIdentifiers.map((arcade) => arcade.id) } },
            { source: { $in: starredArcadeIdentifiers.map((arcade) => arcade.source) } }
          ]
        })
        .toArray();
    }

    return {
      starredArcades: starredArcades.map((arcade) => ({
        id: arcade.id,
        name: arcade.name,
        location: arcade.location,
        games: arcade.games || [],
        source: arcade.source
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
      const arcadeSource = formData.get('arcadeSource') as ShopSource;
      const arcadeIdRaw = formData.get('arcadeId');
      const arcadeId = parseInt(arcadeIdRaw as string, 10);

      if (!arcadeSource) {
        return fail(400, { message: 'Arcade source is required' });
      }

      if (!Number.isInteger(arcadeId) || isNaN(arcadeId)) {
        return fail(400, { message: 'Arcade ID is required and must be a valid integer' });
      }

      const db = client.db();
      const usersCollection = db.collection<User>('users');
      const shopsCollection = db.collection<Shop>('shops');

      // Check if arcade exists
      const arcade = await shopsCollection.findOne({ id: arcadeId, source: arcadeSource });
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
      const arcadeIdRaw = formData.get('arcadeId');
      const arcadeId = parseInt(arcadeIdRaw as string, 10);
      const arcadeSource = formData.get('arcadeSource') as ShopSource;

      if (!Number.isInteger(arcadeId) || isNaN(arcadeId)) {
        return fail(400, { message: 'Arcade ID is required and must be a valid integer' });
      }

      const db = client.db();
      const usersCollection = db.collection<User>('users');

      // Remove arcade from user's starred list
      await usersCollection.updateOne(
        { id: user.id },
        {
          $pull: { starredArcades: { id: arcadeId, source: arcadeSource } },
          $set: { updatedAt: new Date() }
        }
      );

      return { success: true, message: 'Arcade unstarred successfully' };
    } catch (err) {
      console.error('Error unstarring arcade:', err);
      return fail(500, { message: 'Failed to unstar arcade' });
    }
  }
};

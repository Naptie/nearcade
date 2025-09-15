import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Shop } from '$lib/types';
import type { User } from '@auth/sveltekit';
import mongo from '$lib/db/index.server';
import type { ShopSource } from '$lib/constants';

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();

  if (!user) {
    return fail(401, { message: 'Unauthorized' });
  }

  try {
    const db = mongo.db();
    const usersCollection = db.collection<User>('users');
    const shopsCollection = db.collection<Shop>('shops');

    // Get user profile with frequenting arcades
    const userProfile = await usersCollection.findOne({ id: user.id });
    const frequentingArcadeIdentifiers = userProfile?.frequentingArcades || [];

    // Get arcade details if there are any
    let frequentingArcades: Shop[] = [];
    if (frequentingArcadeIdentifiers.length > 0) {
      frequentingArcades = await shopsCollection
        .find({
          $and: [
            { id: { $in: frequentingArcadeIdentifiers.map((id) => id.id) } },
            { source: { $in: frequentingArcadeIdentifiers.map((id) => id.source) } }
          ]
        })
        .toArray();
    }

    return {
      frequentingArcades: frequentingArcades.map((arcade) => ({
        _id: arcade._id.toString(),
        id: arcade.id,
        name: arcade.name,
        location: arcade.location,
        games: arcade.games || [],
        source: arcade.source
      })),
      autoDiscovery: userProfile?.autoDiscovery ?? {
        discoveryInteractionThreshold: 5,
        attendanceThreshold: 2
      }
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
      const arcadeSource = formData.get('arcadeSource') as ShopSource;
      const arcadeIdRaw = formData.get('arcadeId');
      const arcadeId = parseInt(arcadeIdRaw as string, 10);

      if (!arcadeSource) {
        return fail(400, { message: 'Arcade source is required' });
      }

      if (!Number.isInteger(arcadeId) || isNaN(arcadeId)) {
        return fail(400, { message: 'Arcade ID is required and must be a valid integer' });
      }

      const db = mongo.db();
      const usersCollection = db.collection<User>('users');
      const shopsCollection = db.collection<Shop>('shops');

      // Check if arcade exists
      const arcade = await shopsCollection.findOne({ id: arcadeId, source: arcadeSource });
      if (!arcade) {
        return fail(404, { message: 'Arcade not found' });
      }

      // Add arcade to user's frequenting list
      await usersCollection.updateOne(
        { id: user.id },
        {
          $addToSet: { frequentingArcades: { id: arcadeId, source: arcadeSource } },
          $set: { updatedAt: new Date() }
        }
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
      const arcadeIdRaw = formData.get('arcadeId');
      const arcadeId = parseInt(arcadeIdRaw as string, 10);
      const arcadeSource = formData.get('arcadeSource') as ShopSource;

      if (!arcadeSource) {
        return fail(400, { message: 'Arcade source is required' });
      }

      if (!Number.isInteger(arcadeId) || isNaN(arcadeId)) {
        return fail(400, { message: 'Arcade ID is required and must be a valid integer' });
      }

      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      // Remove arcade from user's frequenting list
      await usersCollection.updateOne(
        { id: user.id },
        {
          $pull: { frequentingArcades: { id: arcadeId, source: arcadeSource } },
          $set: { updatedAt: new Date() }
        }
      );

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
      const discoveryInteractionThreshold = parseInt(
        formData.get('discoveryInteractionThreshold') as string
      );
      const attendanceThreshold = parseInt(formData.get('attendanceThreshold') as string);

      if (
        !discoveryInteractionThreshold ||
        discoveryInteractionThreshold < 1 ||
        discoveryInteractionThreshold > 100
      ) {
        return fail(400, { message: 'Discovery interaction threshold must be between 1 and 100' });
      }

      if (!attendanceThreshold || attendanceThreshold < 1 || attendanceThreshold > 100) {
        return fail(400, { message: 'Attendance threshold must be between 1 and 100' });
      }

      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      // Update user's auto-discovery threshold
      await usersCollection.updateOne(
        { id: user.id },
        {
          $set: {
            'autoDiscovery.discoveryInteractionThreshold': discoveryInteractionThreshold,
            'autoDiscovery.attendanceThreshold': attendanceThreshold,
            updatedAt: new Date()
          }
        }
      );

      return { success: true, message: 'Settings updated successfully' };
    } catch (err) {
      console.error('Error updating settings:', err);
      return fail(500, { message: 'Failed to update settings' });
    }
  }
};

import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Shop } from '$lib/types';
import type { User } from '@auth/sveltekit';
import mongo from '$lib/db/index.server';
import type { ShopSource } from '$lib/constants';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();

  if (!user) {
    error(401, m.unauthorized());
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
      return fail(401, { message: m.unauthorized() });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const arcadeSource = formData.get('arcadeSource') as ShopSource;
      const arcadeIdRaw = formData.get('arcadeId');
      const arcadeId = parseInt(arcadeIdRaw as string, 10);

      if (!arcadeSource) {
        return fail(400, { message: m.arcade_source_is_required() });
      }

      if (!Number.isInteger(arcadeId) || isNaN(arcadeId)) {
        return fail(400, { message: m.arcade_id_is_required_and_must_be_a_valid_integer() });
      }

      const db = mongo.db();
      const usersCollection = db.collection<User>('users');
      const shopsCollection = db.collection<Shop>('shops');

      // Check if arcade exists
      const arcade = await shopsCollection.findOne({ id: arcadeId, source: arcadeSource });
      if (!arcade) {
        return fail(404, { message: m.arcade_not_found() });
      }

      // Add arcade to user's frequenting list
      await usersCollection.updateOne(
        { id: user.id },
        {
          $addToSet: { frequentingArcades: { id: arcadeId, source: arcadeSource } },
          $set: { updatedAt: new Date() }
        }
      );

      return { success: true };
    } catch (err) {
      console.error('Error adding arcade:', err);
      return fail(500, { message: m.failed_to_add_arcade() });
    }
  },

  removeArcade: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const arcadeIdRaw = formData.get('arcadeId');
      const arcadeId = parseInt(arcadeIdRaw as string, 10);
      const arcadeSource = formData.get('arcadeSource') as ShopSource;

      if (!arcadeSource) {
        return fail(400, { message: m.arcade_source_is_required() });
      }

      if (!Number.isInteger(arcadeId) || isNaN(arcadeId)) {
        return fail(400, { message: m.arcade_id_is_required_and_must_be_a_valid_integer() });
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

      return { success: true };
    } catch (err) {
      console.error('Error removing arcade:', err);
      return fail(500, { message: m.failed_to_remove_arcade() });
    }
  },

  updateSettings: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
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
        return fail(400, {
          message: m.discovery_interaction_threshold_must_be_between_1_and_100()
        });
      }

      if (!attendanceThreshold || attendanceThreshold < 1 || attendanceThreshold > 100) {
        return fail(400, { message: m.attendance_threshold_must_be_between_1_and_100() });
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

      return { success: true };
    } catch (err) {
      console.error('Error updating settings:', err);
      return fail(500, { message: m.failed_to_update_settings() });
    }
  }
};

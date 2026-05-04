import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { User } from '$lib/auth/types';
import type { Shop } from '$lib/types';
import mongo from '$lib/db/index.server';
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

    // Get user profile with starred arcades
    const userProfile = await usersCollection.findOne({ id: user.id });
    const starredArcadeIds = userProfile?.starredArcades || [];

    // Get arcade details if there are any
    let starredArcades: Shop[] = [];
    if (starredArcadeIds.length > 0) {
      starredArcades = await shopsCollection
        .find({
          id: { $in: starredArcadeIds }
        })
        .toArray();
    }

    return {
      starredArcades: starredArcades.map((arcade) => ({
        _id: arcade._id.toString(),
        id: arcade.id,
        name: arcade.name,
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
    const session = locals.session;
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const arcadeIdRaw = formData.get('arcadeId');
      const arcadeId = parseInt(arcadeIdRaw as string, 10);

      if (!Number.isInteger(arcadeId) || isNaN(arcadeId)) {
        return fail(400, { message: m.arcade_id_is_required_and_must_be_a_valid_integer() });
      }

      const db = mongo.db();
      const usersCollection = db.collection<User>('users');
      const shopsCollection = db.collection<Shop>('shops');

      // Check if arcade exists
      const arcade = await shopsCollection.findOne({ id: arcadeId });
      if (!arcade) {
        return fail(404, { message: m.arcade_not_found() });
      }

      // Add arcade to user's starred list
      await usersCollection.updateOne(
        { id: user.id },
        {
          $addToSet: { starredArcades: arcadeId },
          $set: { updatedAt: new Date() }
        }
      );

      return { success: true };
    } catch (err) {
      console.error('Error starring arcade:', err);
      return fail(500, { message: m.failed_to_star_arcade() });
    }
  },

  removeArcade: async ({ request, locals }) => {
    const session = locals.session;
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const arcadeIdRaw = formData.get('arcadeId');
      const arcadeId = parseInt(arcadeIdRaw as string, 10);

      if (!Number.isInteger(arcadeId) || isNaN(arcadeId)) {
        return fail(400, { message: m.arcade_id_is_required_and_must_be_a_valid_integer() });
      }

      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      // Remove arcade from user's starred list
      await usersCollection.updateOne(
        { id: user.id },
        {
          $pull: { starredArcades: arcadeId },
          $set: { updatedAt: new Date() }
        }
      );

      return { success: true };
    } catch (err) {
      console.error('Error unstarring arcade:', err);
      return fail(500, { message: m.failed_to_unstar_arcade() });
    }
  }
};

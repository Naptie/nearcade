import { fail } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { MongoClient, ObjectId } from 'mongodb';
import type { PageServerLoad, Actions } from './$types';

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

  return {
    userProfile: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      bio: user.bio,
      displayName: user.displayName,
      userType: user.userType,
      isEmailPublic: user.isEmailPublic,
      isUniversityPublic: user.isUniversityPublic
    }
  };
};

export const actions: Actions = {
  updateProfile: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    const user = session.user;

    try {
      const formData = await request.formData();
      const displayName = formData.get('displayName') as string;
      const bio = formData.get('bio') as string;
      const username = formData.get('username') as string;
      const isEmailPublic = formData.get('isEmailPublic') === 'on';
      const isUniversityPublic = formData.get('isUniversityPublic') === 'on';

      if (!displayName?.trim()) {
        return fail(400, { message: 'Display name is required' });
      }

      // If username is provided, validate it
      if (username && username !== user.name) {
        // Validate username format
        if (!/^[A-Za-z0-9_-]+$/.test(username)) {
          return fail(400, {
            message: 'Username can only contain letters, numbers, underscores, and hyphens'
          });
        }

        const mongoClient = await clientPromise;
        const db = mongoClient.db();
        const usersCollection = db.collection('users');

        // Check if username is taken (excluding current user)
        const existingUser = await usersCollection.findOne({
          name: username,
          _id: { $ne: new ObjectId(user.id) }
        });

        if (existingUser) {
          return fail(400, { message: 'This username is already taken' });
        }
      }

      const mongoClient = await clientPromise;
      const db = mongoClient.db();
      const usersCollection = db.collection('users');

      const updateData: {
        displayName: string;
        bio: string;
        isEmailPublic: boolean;
        isUniversityPublic: boolean;
        updatedAt: Date;
        name?: string;
      } = {
        displayName: displayName.trim(),
        bio: bio.trim(),
        isEmailPublic,
        isUniversityPublic,
        updatedAt: new Date()
      };

      // Only update username if it's different
      if (username && username !== user.name) {
        updateData.name = username.trim();
      }

      await usersCollection.updateOne({ _id: new ObjectId(user.id) }, { $set: updateData });

      return { success: true, message: 'Profile updated successfully' };
    } catch (err) {
      console.error('Error updating profile:', err);
      return fail(500, { message: 'Failed to update profile' });
    }
  }
};

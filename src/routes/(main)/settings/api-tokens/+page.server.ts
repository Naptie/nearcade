import { error, fail } from '@sveltejs/kit';
import { ObjectId } from 'mongodb';
import { customAlphabet, nanoid } from 'nanoid';
import type { PageServerLoad, Actions } from './$types';
import mongo from '$lib/db/index.server';
import type { User } from '@auth/sveltekit';
import { alphabet } from '$lib/utils';

export const load: PageServerLoad = async ({ parent }) => {
  const { user } = await parent();

  if (!user) {
    error(401, 'Unauthorized');
  }

  return {
    apiTokens: user.apiTokens || []
  };
};

export const actions: Actions = {
  createToken: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const name = formData.get('name') as string;
      const expirationOption = formData.get('expiration') as string;
      const customDate = formData.get('customDate') as string;

      // Validate name
      if (!name || name.trim() === '') {
        return fail(400, {
          message: 'api_token_name_required',
          fieldErrors: { name: 'api_token_name_required' }
        });
      }

      if (name.trim().length > 50) {
        return fail(400, {
          message: 'name_too_long',
          fieldErrors: { name: 'name_too_long' }
        });
      }

      // Calculate expiration date
      let expiresAt: Date;
      const now = new Date();

      switch (expirationOption) {
        case '1day':
          expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          break;
        case '1week':
          expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        case '30days':
          expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          break;
        case '90days':
          expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
          break;
        case '1year':
          expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
          break;
        case 'custom': {
          if (!customDate) {
            return fail(400, {
              message: 'field_required',
              fieldErrors: { customDate: 'field_required' }
            });
          }
          expiresAt = new Date(customDate);
          if (expiresAt <= now) {
            return fail(400, {
              message: 'Expiration date must be in the future',
              fieldErrors: { customDate: 'Expiration date must be in the future' }
            });
          }
          // Check maximum 1 year limit
          const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
          if (expiresAt > oneYearFromNow) {
            return fail(400, {
              message: 'Maximum expiration is 1 year',
              fieldErrors: { customDate: 'Maximum expiration is 1 year' }
            });
          }
          break;
        }
        default:
          return fail(400, {
            message: 'Invalid expiration option',
            fieldErrors: { expiration: 'Invalid expiration option' }
          });
      }

      // Generate token
      const token = `nk_${customAlphabet(alphabet, 42)()}`;
      const apiTokenId = nanoid();

      const newToken = {
        id: apiTokenId,
        name: name.trim(),
        token: token,
        expiresAt: expiresAt,
        createdAt: new Date()
      };

      // Update user with new API token
      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      await usersCollection.updateOne(
        { _id: new ObjectId(session.user.id) },
        {
          $push: { apiTokens: newToken },
          $set: { updatedAt: new Date() }
        }
      );

      return {
        success: true,
        message: 'api_token_created',
        token: newToken
      };
    } catch (err) {
      console.error('Error creating API token:', err);
      return fail(500, {
        message: 'An error occurred while creating the token'
      });
    }
  },

  renameToken: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const tokenId = formData.get('tokenId') as string;
      const name = formData.get('name') as string;

      // Validate inputs
      if (!tokenId || !name || name.trim() === '') {
        return fail(400, {
          message: 'api_token_name_required',
          fieldErrors: { name: 'api_token_name_required' }
        });
      }

      if (name.trim().length > 50) {
        return fail(400, {
          message: 'name_too_long',
          fieldErrors: { name: 'name_too_long' }
        });
      }

      // Update the token name
      const db = mongo.db();
      const usersCollection = db.collection('users');

      await usersCollection.updateOne(
        {
          _id: new ObjectId(session.user.id),
          'apiTokens.id': tokenId
        },
        {
          $set: {
            'apiTokens.$.name': name.trim(),
            updatedAt: new Date()
          }
        }
      );

      return {
        success: true,
        message: 'api_token_renamed'
      };
    } catch (err) {
      console.error('Error renaming API token:', err);
      return fail(500, {
        message: 'An error occurred while renaming the token'
      });
    }
  },

  resetToken: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const tokenId = formData.get('tokenId') as string;

      if (!tokenId) {
        return fail(400, {
          message: 'Token ID is required'
        });
      }

      // Find the existing token to get its name and expiration
      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      const user = await usersCollection.findOne(
        { _id: new ObjectId(session.user.id) },
        { projection: { apiTokens: 1 } }
      );

      if (!user || !user.apiTokens) {
        return fail(404, {
          message: 'User or tokens not found'
        });
      }

      const existingToken = user.apiTokens.find((token) => token.id === tokenId);
      if (!existingToken) {
        return fail(404, {
          message: 'Token not found'
        });
      }

      if (existingToken.expiresAt < new Date()) {
        return fail(400, {
          message: 'Cannot reset an expired token'
        });
      }

      // Generate new token with same name and expiration
      const newTokenValue = `nk_${customAlphabet(alphabet, 42)()}`;

      const updatedToken = {
        ...existingToken,
        token: newTokenValue,
        createdAt: new Date()
      };

      // Update the token in the database
      await usersCollection.updateOne(
        {
          _id: new ObjectId(session.user.id),
          'apiTokens.id': tokenId
        },
        {
          $set: {
            'apiTokens.$.token': newTokenValue,
            'apiTokens.$.createdAt': new Date(),
            updatedAt: new Date()
          }
        }
      );

      return {
        success: true,
        message: 'api_token_reset',
        token: updatedToken
      };
    } catch (err) {
      console.error('Error resetting API token:', err);
      return fail(500, {
        message: 'An error occurred while resetting the token'
      });
    }
  },

  deleteToken: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    try {
      const formData = await request.formData();
      const tokenId = formData.get('tokenId') as string;

      if (!tokenId) {
        return fail(400, {
          message: 'Token ID is required'
        });
      }

      // Remove the token from user's apiTokens array
      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      await usersCollection.updateOne(
        { _id: new ObjectId(session.user.id) },
        {
          $pull: { apiTokens: { id: tokenId } },
          $set: { updatedAt: new Date() }
        }
      );

      return {
        success: true,
        message: 'api_token_deleted'
      };
    } catch (err) {
      console.error('Error deleting API token:', err);
      return fail(500, {
        message: 'An error occurred while deleting the token'
      });
    }
  }
};

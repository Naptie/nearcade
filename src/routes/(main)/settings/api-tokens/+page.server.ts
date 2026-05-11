import { error, fail } from '@sveltejs/kit';
import type { ApiKey } from '@better-auth/api-key';
import type { PageServerLoad, Actions } from './$types';
import { auth } from '$lib/auth/index.server';
import { ensureLegacyApiTokensMigrated } from '$lib/auth/api-keys.server';
import { m } from '$lib/paraglide/messages';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const YEAR_IN_MS = 365 * DAY_IN_MS;
const MAX_TOKEN_NAME_LENGTH = 50;

type ApiTokenListItem = {
  id: string;
  name: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
};

const getUnauthorizedFailure = () => fail(401, { message: 'unauthorized' });

const mapApiKeyToListItem = (
  apiKey: Pick<ApiKey, 'id' | 'name' | 'expiresAt' | 'createdAt'> & { key?: string }
): ApiTokenListItem => ({
  id: apiKey.id,
  name: apiKey.name ?? '',
  token: apiKey.key ?? '',
  expiresAt: apiKey.expiresAt ?? new Date(Date.now() + YEAR_IN_MS),
  createdAt: apiKey.createdAt
});

const getExpirationDate = (expirationOption: string, customDate: string) => {
  const now = new Date();

  switch (expirationOption) {
    case '1day':
      return new Date(now.getTime() + DAY_IN_MS);
    case '1week':
      return new Date(now.getTime() + 7 * DAY_IN_MS);
    case '30days':
      return new Date(now.getTime() + 30 * DAY_IN_MS);
    case '90days':
      return new Date(now.getTime() + 90 * DAY_IN_MS);
    case '1year':
      return new Date(now.getTime() + YEAR_IN_MS);
    case 'custom': {
      if (!customDate) {
        return fail(400, {
          message: 'field_required',
          fieldErrors: { customDate: 'field_required' }
        });
      }

      const expiresAt = new Date(customDate);
      if (expiresAt <= now) {
        return fail(400, {
          message: 'expiration_date_must_be_future',
          fieldErrors: { customDate: 'expiration_date_must_be_future' }
        });
      }

      const oneYearFromNow = new Date(now.getTime() + YEAR_IN_MS);
      if (expiresAt > oneYearFromNow) {
        return fail(400, {
          message: 'maximum_expiration_one_year',
          fieldErrors: { customDate: 'maximum_expiration_one_year' }
        });
      }

      return expiresAt;
    }
    default:
      return fail(400, {
        message: 'invalid_expiration_option',
        fieldErrors: { expiration: 'invalid_expiration_option' }
      });
  }
};

export const load: PageServerLoad = async ({ parent, request }) => {
  const { user } = await parent();

  if (!user) {
    error(401, m.error_401_title());
  }

  await ensureLegacyApiTokensMigrated(user.id);

  const { apiKeys } = await auth.api.listApiKeys({
    headers: request.headers,
    query: {
      sortBy: 'createdAt',
      sortDirection: 'desc'
    }
  });

  return {
    apiTokens: apiKeys.map(mapApiKeyToListItem)
  };
};

export const actions: Actions = {
  createToken: async ({ request, locals }) => {
    const session = locals.session;
    if (!session?.user) {
      return getUnauthorizedFailure();
    }

    try {
      const formData = await request.formData();
      const name = String(formData.get('name') ?? '');
      const expirationOption = String(formData.get('expiration') ?? '');
      const customDate = String(formData.get('customDate') ?? '');

      if (!name.trim()) {
        return fail(400, {
          message: 'api_token_name_required',
          fieldErrors: { name: 'api_token_name_required' }
        });
      }

      if (name.trim().length > MAX_TOKEN_NAME_LENGTH) {
        return fail(400, {
          message: 'name_too_long',
          fieldErrors: { name: 'name_too_long' }
        });
      }

      const expirationResult = getExpirationDate(expirationOption, customDate);
      if (!(expirationResult instanceof Date)) {
        return expirationResult;
      }

      await ensureLegacyApiTokensMigrated(session.user.id);

      const expiresIn = Math.ceil((expirationResult.getTime() - Date.now()) / 1000);
      const apiKey = await auth.api.createApiKey({
        headers: request.headers,
        body: {
          name: name.trim(),
          expiresIn
        }
      });

      return {
        success: true,
        message: 'api_token_created',
        token: mapApiKeyToListItem(apiKey)
      };
    } catch (err) {
      console.error('Error creating API token:', err);
      return fail(500, {
        message: 'error_creating_token'
      });
    }
  },

  renameToken: async ({ request, locals }) => {
    const session = locals.session;
    if (!session?.user) {
      return getUnauthorizedFailure();
    }

    try {
      const formData = await request.formData();
      const tokenId = String(formData.get('tokenId') ?? '');
      const name = String(formData.get('name') ?? '');

      if (!tokenId || !name.trim()) {
        return fail(400, {
          message: 'api_token_name_required',
          fieldErrors: { name: 'api_token_name_required' }
        });
      }

      if (name.trim().length > MAX_TOKEN_NAME_LENGTH) {
        return fail(400, {
          message: 'name_too_long',
          fieldErrors: { name: 'name_too_long' }
        });
      }

      await ensureLegacyApiTokensMigrated(session.user.id);

      await auth.api.updateApiKey({
        headers: request.headers,
        body: {
          keyId: tokenId,
          name: name.trim()
        }
      });

      return {
        success: true,
        message: 'api_token_renamed'
      };
    } catch (err) {
      console.error('Error renaming API token:', err);
      return fail(500, {
        message: 'error_renaming_token'
      });
    }
  },

  resetToken: async ({ request, locals }) => {
    const session = locals.session;
    if (!session?.user) {
      return getUnauthorizedFailure();
    }

    try {
      const formData = await request.formData();
      const tokenId = String(formData.get('tokenId') ?? '');

      if (!tokenId) {
        return fail(400, {
          message: 'token_id_required'
        });
      }

      await ensureLegacyApiTokensMigrated(session.user.id);

      const existingKey = await auth.api.getApiKey({
        headers: request.headers,
        query: { id: tokenId }
      });

      if (!existingKey.expiresAt || existingKey.expiresAt < new Date()) {
        return fail(400, {
          message: 'cannot_reset_expired_token'
        });
      }

      const expiresIn = Math.ceil((existingKey.expiresAt.getTime() - Date.now()) / 1000);
      if (expiresIn <= 0) {
        return fail(400, {
          message: 'cannot_reset_expired_token'
        });
      }

      let newApiKey: Awaited<ReturnType<typeof auth.api.createApiKey>> | null = null;

      try {
        newApiKey = await auth.api.createApiKey({
          headers: request.headers,
          body: {
            name: existingKey.name ?? '',
            expiresIn,
            metadata: existingKey.metadata ?? undefined
          }
        });

        await auth.api.deleteApiKey({
          headers: request.headers,
          body: { keyId: tokenId }
        });
      } catch (error) {
        if (newApiKey) {
          await auth.api
            .deleteApiKey({
              headers: request.headers,
              body: { keyId: newApiKey.id }
            })
            .catch(() => null);
        }

        throw error;
      }

      return {
        success: true,
        message: 'api_token_reset',
        token: mapApiKeyToListItem(newApiKey)
      };
    } catch (err) {
      console.error('Error resetting API token:', err);
      return fail(500, {
        message: 'error_resetting_token'
      });
    }
  },

  deleteToken: async ({ request, locals }) => {
    const session = locals.session;
    if (!session?.user) {
      return getUnauthorizedFailure();
    }

    try {
      const formData = await request.formData();
      const tokenId = String(formData.get('tokenId') ?? '');

      if (!tokenId) {
        return fail(400, {
          message: 'token_id_required'
        });
      }

      await ensureLegacyApiTokensMigrated(session.user.id);

      await auth.api.deleteApiKey({
        headers: request.headers,
        body: { keyId: tokenId }
      });

      return {
        success: true,
        message: 'api_token_deleted'
      };
    } catch (err) {
      console.error('Error deleting API token:', err);
      return fail(500, {
        message: 'error_deleting_token'
      });
    }
  }
};

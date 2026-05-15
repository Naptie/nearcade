import { auth } from '$lib/auth/index.server';
import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { m } from '$lib/paraglide/messages';
import mongo from '$lib/db/index.server';
import { listOAuthClients } from '$lib/auth/oauth/clients.server';

const canManageOAuthClients = (userType?: string) =>
  userType === 'site_admin' || userType === 'developer';

type CreatedOAuthClient = {
  client_id: string;
  client_secret?: string;
};

const isCreatedOAuthClientResponse = (
  value: unknown
): value is { response: CreatedOAuthClient } => {
  return (
    !!value &&
    typeof value === 'object' &&
    'response' in value &&
    !!value.response &&
    typeof value.response === 'object'
  );
};

const deleteManagedOAuthClient = async (userType: string, request: Request, clientId: string) => {
  if (userType === 'site_admin') {
    // Better Auth only lets owners delete through the API, so site admins use the stored record directly.
    return mongo.db().collection('oauth_clients').deleteOne({ clientId });
  }

  await auth.api.deleteOAuthClient({
    body: { client_id: clientId },
    headers: request.headers
  });

  return null;
};

const updateManagedOAuthClient = async (
  userType: string,
  request: Request,
  clientId: string,
  update: {
    name: string;
    redirectUris: string[];
    skipConsent: boolean;
    uri?: string;
    icon?: string;
  }
) => {
  if (userType === 'site_admin') {
    return mongo
      .db()
      .collection('oauth_clients')
      .updateOne(
        { clientId },
        {
          $set: {
            name: update.name,
            redirectUris: update.redirectUris,
            skipConsent: update.skipConsent,
            updatedAt: new Date(),
            ...(update.uri !== undefined ? { uri: update.uri } : {}),
            ...(update.icon !== undefined ? { icon: update.icon } : {})
          }
        }
      );
  }

  await auth.api.adminUpdateOAuthClient({
    headers: request.headers,
    body: {
      client_id: clientId,
      update: {
        client_name: update.name,
        redirect_uris: update.redirectUris,
        skip_consent: update.skipConsent,
        ...(update.uri !== undefined ? { client_uri: update.uri } : {}),
        ...(update.icon !== undefined ? { logo_uri: update.icon } : {})
      }
    }
  });

  return null;
};

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.session?.user;

  if (!canManageOAuthClients(user?.userType)) {
    error(403, m.access_denied());
  }

  try {
    const clients = await listOAuthClients(mongo.db(), {
      isSiteAdmin: user.userType === 'site_admin',
      userId: user.id
    });

    return {
      clients,
      isSiteAdmin: user.userType === 'site_admin'
    };
  } catch {
    return { clients: [], isSiteAdmin: user.userType === 'site_admin' };
  }
};

export const actions = {
  create: async ({ request, locals }) => {
    const user = locals.session?.user;

    if (!canManageOAuthClients(user?.userType)) {
      return fail(403, { error: 'Forbidden' });
    }

    const formData = await request.formData();
    const name = formData.get('name')?.toString().trim() ?? '';
    const redirectUris =
      formData
        .get('redirect_uris')
        ?.toString()
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    const isPublic = formData.get('is_public') === 'on';
    const skipConsent = formData.get('skip_consent') === 'on';
    const uri = formData.get('uri')?.toString().trim() || undefined;
    const icon = formData.get('icon')?.toString().trim() || undefined;

    if (!name) {
      return fail(400, {
        error: 'Client name is required',
        name,
        redirect_uris: redirectUris.join('\n')
      });
    }
    if (redirectUris.length === 0) {
      return fail(400, {
        error: 'At least one redirect URI is required',
        name,
        redirect_uris: redirectUris.join('\n')
      });
    }

    try {
      const result = await auth.api.adminCreateOAuthClient({
        headers: request.headers,
        body: {
          client_name: name,
          redirect_uris: redirectUris,
          token_endpoint_auth_method: isPublic ? 'none' : 'client_secret_post',
          skip_consent: skipConsent,
          ...(uri ? { client_uri: uri } : {}),
          ...(icon ? { logo_uri: icon } : {})
        }
      });
      // Better Auth server helpers may return the payload directly or wrapped in `response`.
      const createdClient = isCreatedOAuthClientResponse(result)
        ? result.response
        : (result as CreatedOAuthClient);

      await mongo
        .db()
        .collection('oauth_clients')
        .updateOne({ clientId: createdClient.client_id }, { $set: { createdBy: user.id } });

      return {
        success: true,
        created: {
          clientId: createdClient.client_id,
          clientSecret: createdClient.client_secret
        }
      };
    } catch (e) {
      return fail(500, {
        error: `Failed to create client: ${e instanceof Error ? e.message : String(e)}`
      });
    }
  },

  delete: async ({ request, locals }) => {
    const user = locals.session?.user;

    if (!canManageOAuthClients(user?.userType)) {
      return fail(403, { error: 'Forbidden' });
    }

    const formData = await request.formData();
    const clientId = formData.get('client_id')?.toString();
    if (!clientId) {
      return fail(400, { error: 'Missing client_id' });
    }

    try {
      const result = await deleteManagedOAuthClient(user.userType, request, clientId);

      if (result) {
        if (result.deletedCount === 0) {
          return fail(404, { error: 'Client not found' });
        }
      }
      return { deleted: true };
    } catch (e) {
      return fail(500, {
        error: `Failed to delete client: ${e instanceof Error ? e.message : e}`
      });
    }
  },

  update: async ({ request, locals }) => {
    const user = locals.session?.user;

    if (!canManageOAuthClients(user?.userType)) {
      return fail(403, { error: 'Forbidden' });
    }

    const formData = await request.formData();
    const clientId = formData.get('client_id')?.toString();
    if (!clientId) {
      return fail(400, { error: 'Missing client_id' });
    }

    const name = formData.get('name')?.toString().trim() ?? '';
    const redirectUris =
      formData
        .get('redirect_uris')
        ?.toString()
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    const skipConsent = formData.get('skip_consent') === 'on';
    const uri = formData.get('uri')?.toString().trim() || undefined;
    const icon = formData.get('icon')?.toString().trim() || undefined;

    if (!name) {
      return fail(400, { error: 'Client name is required', updateClientId: clientId });
    }
    if (redirectUris.length === 0) {
      return fail(400, {
        error: 'At least one redirect URI is required',
        updateClientId: clientId
      });
    }

    try {
      const result = await updateManagedOAuthClient(user.userType, request, clientId, {
        name,
        redirectUris,
        skipConsent,
        uri,
        icon
      });

      if (result) {
        if (result.matchedCount === 0) {
          return fail(404, { error: 'Client not found' });
        }
      }
      return { updated: true };
    } catch (e) {
      return fail(500, {
        error: `Failed to update client: ${e instanceof Error ? e.message : String(e)}`
      });
    }
  }
} satisfies Actions;

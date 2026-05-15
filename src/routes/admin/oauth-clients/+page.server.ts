import { auth } from '$lib/auth/index.server';
import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { m } from '$lib/paraglide/messages';
import mongo from '$lib/db/index.server';
import { listOAuthClients } from '$lib/auth/oauth/clients.server';

const canManageOAuthClients = (userType?: string) =>
  userType === 'site_admin' || userType === 'developer';

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
      const createdClient = ('response' in result ? result.response : result) as {
        client_id: string;
        client_secret?: string;
      };

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
      if (user.userType === 'site_admin') {
        const result = await mongo.db().collection('oauth_clients').deleteOne({ clientId });
        if (result.deletedCount === 0) {
          return fail(404, { error: 'Client not found' });
        }
      } else {
        await auth.api.deleteOAuthClient({
          body: { client_id: clientId },
          headers: request.headers
        });
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
      if (user.userType === 'site_admin') {
        const result = await mongo
          .db()
          .collection('oauth_clients')
          .updateOne(
            { clientId },
            {
              $set: {
                name,
                redirectUris,
                skipConsent,
                updatedAt: new Date(),
                ...(uri !== undefined ? { uri } : {}),
                ...(icon !== undefined ? { icon } : {})
              }
            }
          );

        if (result.matchedCount === 0) {
          return fail(404, { error: 'Client not found' });
        }
      } else {
        await auth.api.adminUpdateOAuthClient({
          headers: request.headers,
          body: {
            client_id: clientId,
            update: {
              client_name: name,
              redirect_uris: redirectUris,
              skip_consent: skipConsent,
              ...(uri !== undefined ? { client_uri: uri } : {}),
              ...(icon !== undefined ? { logo_uri: icon } : {})
            }
          }
        });
      }
      return { updated: true };
    } catch (e) {
      return fail(500, {
        error: `Failed to update client: ${e instanceof Error ? e.message : String(e)}`
      });
    }
  }
} satisfies Actions;

import { auth } from '$lib/auth/index.server';
import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ locals, request }) => {
  if (locals.session?.user?.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  try {
    const clients = await auth.api.getOAuthClients({
      headers: request.headers
    });

    return {
      clients: clients?.map((c) => ({
        clientId: c.client_id,
        name: c.client_name ?? c.client_id,
        icon: c.logo_uri ? c.logo_uri : null,
        uri: c.client_uri ? c.client_uri : null,
        redirectUris: c.redirect_uris,
        isPublic: !!c.public,
        disabled: !!c.disabled,
        skipConsent: !!c.skip_consent,
        createdAt: c.client_id_issued_at
          ? new Date((c.client_id_issued_at as number) * 1000).toISOString()
          : null,
        scopes: typeof c.scope === 'string' && c.scope ? c.scope.split(' ') : []
      }))
    };
  } catch {
    return { clients: [] };
  }
};

export const actions = {
  create: async ({ request, locals }) => {
    if (locals.session?.user?.userType !== 'site_admin') {
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

      return {
        success: true,
        created: {
          clientId: result.client_id,
          clientSecret: result.client_secret
        }
      };
    } catch (e) {
      return fail(500, {
        error: `Failed to create client: ${e instanceof Error ? e.message : String(e)}`
      });
    }
  },

  delete: async ({ request, locals }) => {
    if (locals.session?.user?.userType !== 'site_admin') {
      return fail(403, { error: 'Forbidden' });
    }

    const formData = await request.formData();
    const clientId = formData.get('client_id')?.toString();
    if (!clientId) {
      return fail(400, { error: 'Missing client_id' });
    }

    try {
      await auth.api.deleteOAuthClient({
        body: { client_id: clientId },
        headers: request.headers
      });
      return { deleted: true };
    } catch (e) {
      return fail(500, {
        error: `Failed to delete client: ${e instanceof Error ? e.message : e}`
      });
    }
  },

  update: async ({ request, locals }) => {
    if (locals.session?.user?.userType !== 'site_admin') {
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
      return { updated: true };
    } catch (e) {
      return fail(500, {
        error: `Failed to update client: ${e instanceof Error ? e.message : String(e)}`
      });
    }
  }
} satisfies Actions;

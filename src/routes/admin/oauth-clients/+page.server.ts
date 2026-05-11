import { auth } from '$lib/auth/index.server';
import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.session?.user?.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  try {
    const clients = await auth.api.getOAuthClients({
      headers: new Headers()
    });

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clients: (clients as any[]).map((c) => ({
        clientId: String(c.clientId ?? ''),
        name: String(c.name ?? c.clientId ?? 'Unnamed'),
        icon: c.icon ? String(c.icon) : null,
        uri: c.uri ? String(c.uri) : null,
        redirectUris: Array.isArray(c.redirectUris) ? c.redirectUris.map(String) : [],
        isPublic: !!c.public,
        disabled: !!c.disabled,
        skipConsent: !!c.skipConsent,
        createdAt: c.createdAt ? new Date(c.createdAt as string).toISOString() : null,
        scopes: Array.isArray(c.scopes) ? c.scopes.map(String) : []
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          clientId: String((result as any).clientId ?? (result as any).client_id ?? ''),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          clientSecret: (result as any).clientSecret ?? (result as any).client_secret ?? null
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
        error: `Failed to delete client: ${e instanceof Error ? e.message : String(e)}`
      });
    }
  }
} satisfies Actions;

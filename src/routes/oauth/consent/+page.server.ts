import { auth } from '$lib/auth/index.server';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

interface OAuthConsentClient {
  name: string;
  icon: string | null;
  uri: string | null;
}

export const load: PageServerLoad = async (event) => {
  const session = event.locals.session;
  if (!session) {
    redirect(
      302,
      `/oauth/sign-in${event.url.search ? `?${event.url.searchParams.toString()}` : ''}`
    );
  }

  const clientId = event.url.searchParams.get('client_id');
  const scope = event.url.searchParams.get('scope') ?? '';

  if (!clientId) {
    return {
      error: 'missing_client_id' as const,
      client: null as OAuthConsentClient | null,
      scopes: [] as string[]
    };
  }

  try {
    const raw = await auth.api.getOAuthClientPublic({
      query: { client_id: clientId },
      headers: event.request.headers
    });

    const client: OAuthConsentClient = {
      name: String(raw.name ?? raw.clientId ?? clientId),
      icon: raw.icon ? String(raw.icon) : null,
      uri: raw.uri ? String(raw.uri) : null
    };

    return {
      error: null as string | null,
      client,
      scopes: scope.split(' ').filter(Boolean)
    };
  } catch {
    return {
      error: 'invalid_client' as const,
      client: null as OAuthConsentClient | null,
      scopes: [] as string[]
    };
  }
};

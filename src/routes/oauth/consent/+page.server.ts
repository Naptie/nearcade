import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import mongo from '$lib/db/index.server';
import { getOAuthClientConsentInfo } from '$lib/auth/oauth/clients.server';

interface OAuthConsentClient {
  name: string;
  icon: string | null;
  uri: string | null;
  creator: {
    name: string | null;
    displayName: string | null;
  } | null;
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
      scopes: [] as string[],
      user: {
        name: session.user.name,
        displayName: session.user.displayName ?? null,
        image: session.user.image ?? null
      }
    };
  }

  try {
    const raw = await getOAuthClientConsentInfo(mongo.db(), clientId);

    if (!raw) {
      throw new Error('Invalid client');
    }

    const client: OAuthConsentClient = {
      name: raw.name,
      icon: raw.icon,
      uri: raw.uri,
      creator: raw.creator
        ? {
            name: raw.creator.name ?? null,
            displayName: raw.creator.displayName ?? null
          }
        : null
    };

    return {
      error: null as string | null,
      client,
      scopes: scope.split(' ').filter(Boolean),
      user: {
        name: session.user.name,
        displayName: session.user.displayName ?? null,
        image: session.user.image ?? null
      }
    };
  } catch {
    return {
      error: 'invalid_client' as const,
      client: null as OAuthConsentClient | null,
      scopes: [] as string[],
      user: {
        name: session.user.name,
        displayName: session.user.displayName ?? null,
        image: session.user.image ?? null
      }
    };
  }
};

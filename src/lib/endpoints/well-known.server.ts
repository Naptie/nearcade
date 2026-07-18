import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata
} from '@better-auth/oauth-provider';
import { auth } from '$lib/auth/index.server';
import type { Handle } from '@sveltejs/kit';
import { base } from '$app/paths';

const WELL_KNOWN_PREFIX = `${base}/.well-known/`;

const handlers: Record<string, (request: Request) => Promise<Response>> = {
  'openid-configuration': oauthProviderOpenIdConfigMetadata(auth),
  'oauth-authorization-server': oauthProviderAuthServerMetadata(auth)
};

export const handleWellKnown: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  if (!pathname.startsWith(WELL_KNOWN_PREFIX)) {
    return resolve(event);
  }

  const slug = pathname.slice(WELL_KNOWN_PREFIX.length);
  const handler = handlers[slug];

  if (!handler) {
    return resolve(event);
  }

  return handler(event.request);
};

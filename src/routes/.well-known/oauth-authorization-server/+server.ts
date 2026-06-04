import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import { auth } from '$lib/auth/index.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const metadata = oauthProviderAuthServerMetadata(auth);
  const response = await metadata(event.request);
  return response;
};

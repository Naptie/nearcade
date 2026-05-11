import { createAuthClient } from 'better-auth/svelte';
import { genericOAuthClient, inferAdditionalFields } from 'better-auth/client/plugins';
import { apiKeyClient } from '@better-auth/api-key/client';
import type { auth } from './index.server';

export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [apiKeyClient(), genericOAuthClient(), inferAdditionalFields<typeof auth>()]
});

import { createAuthClient } from 'better-auth/svelte';
import { genericOAuthClient, inferAdditionalFields } from 'better-auth/client/plugins';
import { apiKeyClient } from '@better-auth/api-key/client';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import type { auth } from './index.server';

export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [
    apiKeyClient(),
    genericOAuthClient(),
    oauthProviderClient(),
    inferAdditionalFields<typeof auth>()
  ]
});

import { createAuthClient } from 'better-auth/svelte';
import { genericOAuthClient, inferAdditionalFields } from 'better-auth/client/plugins';
import type { auth } from './index.server';

export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [genericOAuthClient(), inferAdditionalFields<typeof auth>()]
});

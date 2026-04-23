import { createAuthClient } from 'better-auth/svelte';
import { genericOAuthClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [genericOAuthClient()]
});

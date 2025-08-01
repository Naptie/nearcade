import { base } from '$app/paths';
import { AUTH_PHIRA_ID, AUTH_PHIRA_SECRET } from '$env/static/private';
import { customFetch } from '@auth/sveltekit';
import type { OAuthUserConfig, OAuth2Config } from '@auth/sveltekit/providers';

/**
 * The user profile data returned from the Phira API /me endpoint.
 */
export interface PhiraProfile {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
}

/**
 * Defines the custom OAuth provider for Phira.
 */
export default function Phira<P extends PhiraProfile>(
  options: OAuthUserConfig<P>
): OAuth2Config<P> {
  const {
    clientId = AUTH_PHIRA_ID,
    clientSecret = AUTH_PHIRA_SECRET,
    checks = ['state'],
    ...rest
  } = options;

  return {
    id: 'phira',
    name: 'Phira',
    type: 'oauth',
    checks: checks.filter((c) => c === 'state' || c === 'none'),
    clientId,
    clientSecret,

    authorization: {
      url: `http://localhost:5173${base}/api/auth/phira`,
      params: {
        scope: '1'
      }
    },

    token: {
      url: 'https://api.phira.cn/oauth/token',
      conform: async (response: Response) => {
        const data = (await response.json()) as object;
        console.log('Phira token response:', data);
        return new Response(
          JSON.stringify({
            ...data,
            token_type: 'bearer'
          }),
          response
        );
      }
    },

    [customFetch]: async (...args) => {
      console.log(args);
      const url = new URL(args[0] instanceof Request ? args[0].url : args[0]);
      if (url.pathname.endsWith('token')) {
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('client_secret', clientSecret);
        (args[1]!.body as URLSearchParams).forEach((value, key) => {
          url.searchParams.set(key, value);
        });
        return fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return fetch(...args);
    },

    userinfo: {
      url: 'https://api.phira.cn/me'
    },

    profile(profile: P) {
      return {
        id: profile.id.toString(),
        name: profile.name,
        email: profile.email,
        image: profile.avatar
      };
    },
    ...rest
  };
}

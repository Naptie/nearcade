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
const Phira = <P extends PhiraProfile>(options: OAuthUserConfig<P>): OAuth2Config<P> => {
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
      url: 'https://phira.moe/oauth',
      params: {
        scope: '1'
      }
    },

    token: {
      url: 'https://api.phira.cn/oauth/token',
      conform: async (response: Response) => {
        const data = (await response.json()) as {
          accessToken: string;
          tokenType: string;
          expiresIn: number;
          refreshToken: string;
        };
        return new Response(
          JSON.stringify({
            access_token: data.accessToken,
            token_type: data.tokenType,
            expires_in: data.expiresIn,
            refresh_token: data.refreshToken
          }),
          response
        );
      }
    },

    [customFetch]: async (...args) => {
      const url = new URL(args[0] instanceof Request ? args[0].url : args[0]);
      if (url.pathname.endsWith('token')) {
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('client_secret', clientSecret);
        (args[1]!.body as URLSearchParams).forEach((value, key) => {
          if (key !== 'redirect_uri') url.searchParams.set(key, value);
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
};

export default Phira;

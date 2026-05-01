import { env } from '$env/dynamic/private';
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { cacheOAuthProfile } from './profile-cache';
import { resolveRedirectURI, getCallbackURI } from '$lib/utils/index.server';

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

export function githubProvider(): GenericOAuthConfig {
  const baseUrl = env.GITHUB_PROXY?.replace(/\/$/, '') ?? 'https://github.com';
  const apiBaseUrl = env.GITHUB_API_PROXY?.replace(/\/$/, '') ?? 'https://api.github.com';
  const clientId = env.AUTH_GITHUB_ID!;
  const clientSecret = env.AUTH_GITHUB_SECRET!;

  return {
    providerId: 'github',
    clientId,
    clientSecret,
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: `${baseUrl}/login/oauth/access_token`,
    userInfoUrl: `${apiBaseUrl}/user`,
    scopes: ['read:user', 'user:email'],
    authorizationUrlParams: (ctx) => ({
      redirect_uri: resolveRedirectURI(
        getCallbackURI(ctx.context.baseURL, 'github'),
        env.AUTH_GITHUB_PROXY
      )
    }),
    async getToken({ code, redirectURI }) {
      const githubRedirectURI = resolveRedirectURI(redirectURI, env.AUTH_GITHUB_PROXY);

      const response = await fetch(`${baseUrl}/login/oauth/access_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: githubRedirectURI
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub OAuth failed: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as {
        access_token: string;
        token_type: string;
        scope: string;
        refresh_token?: string;
        expires_in?: number;
        refresh_token_expires_in?: number;
        error?: string;
        error_description?: string;
      };

      if (data.error) {
        throw new Error(`GitHub OAuth Error: ${data.error_description || data.error}`);
      }

      return {
        accessToken: data.access_token,
        tokenType: data.token_type || 'bearer',
        refreshToken: data.refresh_token,
        accessTokenExpiresAt: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000)
          : undefined,
        raw: data
      };
    },
    async getUserInfo(tokens) {
      const profile = (await fetch(`${apiBaseUrl}/user`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'User-Agent': 'better-auth'
        }
      }).then((res) => res.json())) as GitHubProfile;

      if (!profile.email) {
        const res = await fetch(`${apiBaseUrl}/user/emails`, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            'User-Agent': 'better-auth'
          }
        });
        if (res.ok) {
          const emails: GitHubEmail[] = await res.json();
          profile.email = (emails.find((e) => e.primary) ?? emails[0]).email;
        }
      }

      const result = {
        id: profile.id.toString(),
        name: profile.name ?? profile.login,
        email: profile.email,
        image: profile.avatar_url,
        emailVerified: false
      };
      if (result.email) {
        await cacheOAuthProfile('github', result.id, { email: result.email, image: result.image });
      }
      return result;
    }
  };
}

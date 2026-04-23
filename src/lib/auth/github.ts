import { env } from '$env/dynamic/private';
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { cacheOAuthProfile } from './profile-cache';

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

  return {
    providerId: 'github',
    clientId: env.AUTH_GITHUB_ID!,
    clientSecret: env.AUTH_GITHUB_SECRET!,
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: `${baseUrl}/login/oauth/access_token`,
    userInfoUrl: `${apiBaseUrl}/user`,
    scopes: ['read:user', 'user:email'],
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

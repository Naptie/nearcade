import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { cacheOAuthProfile } from './profile-cache';
import type { ProviderCredentials } from './providers';

/**
 * Diving-Fish (水鱼) account OAuth — the authorization server behind the
 * maimai DX / CHUNITHM prober.
 *
 * Reference: https://maimai.diving-fish.com/manual/docs/developer/oauth-quickstart
 * - PKCE (S256) is mandatory for every client, including confidential ones.
 * - Token requests must include `client_secret` in the form body
 *   (`client_secret_post`), which is better-auth's default.
 * - `openid` scope is required before `/oauth/userinfo` can be called.
 * - `email` scope returns the account's `email` / `email_verified` claims;
 *   falling back to a placeholder keeps nearcade accounts functional even
 *   when the email permission is not granted.
 * - `preferred_username` is the verified prober username (查分器用户名).
 */

export const DIVING_FISH_AUTH_BASE = 'https://auth.diving-fish.com';

export interface DivingFishUserInfo {
  sub: string;
  preferred_username?: string;
  name?: string;
  nickname?: string;
  email?: string;
  email_verified?: boolean;
}

export function divingFishProvider({
  clientId,
  clientSecret
}: ProviderCredentials): GenericOAuthConfig {
  return {
    providerId: 'diving-fish',
    clientId,
    clientSecret,
    authorizationUrl: `${DIVING_FISH_AUTH_BASE}/oauth/authorize`,
    tokenUrl: `${DIVING_FISH_AUTH_BASE}/oauth/token`,
    userInfoUrl: `${DIVING_FISH_AUTH_BASE}/oauth/userinfo`,
    scopes: ['openid', 'profile', 'email'],
    pkce: true,
    async mapProfileToUser(profile: Record<string, unknown>) {
      const p = profile as unknown as DivingFishUserInfo;
      if (!p.sub) return {};
      const email = p.email ?? `${p.sub}@diving-fish.nearcade`;
      const mapped = {
        id: p.sub,
        name: p.nickname ?? p.name ?? p.preferred_username ?? '',
        email,
        emailVerified: p.email_verified ?? false,
        username: p.preferred_username
      };
      await cacheOAuthProfile('diving-fish', p.sub, {
        email,
        username: p.preferred_username
      });
      return mapped;
    }
  };
}

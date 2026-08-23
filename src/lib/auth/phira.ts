import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { cacheOAuthProfile } from './profile-cache';
import type { ProviderCredentials } from './providers';

export interface PhiraProfile {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
}

export function phiraProvider({ clientId, clientSecret }: ProviderCredentials): GenericOAuthConfig {
  return {
    providerId: 'phira',
    clientId,
    clientSecret,
    authorizationUrl: 'https://phira.moe/oauth',
    tokenUrl: 'https://api.phira.cn/oauth/token',
    userInfoUrl: 'https://api.phira.cn/me',
    scopes: ['1'],
    async getToken({ code }) {
      const url = new URL('https://api.phira.cn/oauth/token');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('client_secret', clientSecret);
      url.searchParams.set('grant_type', 'authorization_code');
      url.searchParams.set('code', code);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = (await response.json()) as {
        accessToken: string;
        tokenType: string;
        expiresIn: number;
        refreshToken: string;
      };

      return {
        accessToken: data.accessToken,
        tokenType: data.tokenType,
        refreshToken: data.refreshToken,
        accessTokenExpiresAt: new Date(Date.now() + data.expiresIn * 1000)
      };
    },
    async mapProfileToUser(profile: Record<string, unknown>) {
      const p = profile as unknown as PhiraProfile;
      const mapped = {
        name: p.name,
        email: p.email,
        image: p.avatar ?? undefined,
        emailVerified: !!p.email
      };
      await cacheOAuthProfile('phira', String(p.id), {
        email: mapped.email,
        image: mapped.image,
        username: p.name
      });
      return mapped;
    }
  };
}

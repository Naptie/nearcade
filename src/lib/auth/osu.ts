import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { cacheOAuthProfile } from './profile-cache';
import type { ProviderCredentials } from './providers';

export function osuProvider({ clientId, clientSecret }: ProviderCredentials): GenericOAuthConfig {
  return {
    providerId: 'osu',
    clientId,
    clientSecret,
    authorizationUrl: 'https://osu.ppy.sh/oauth/authorize',
    tokenUrl: 'https://osu.ppy.sh/oauth/token',
    userInfoUrl: 'https://osu.ppy.sh/api/v2/me',
    scopes: ['identify'],
    async mapProfileToUser(profile: Record<string, unknown>) {
      const p = profile as { id: number; username: string; avatar_url: string };
      const mapped = {
        name: p.username,
        email: `${p.id}@osu.nearcade`,
        image: p.avatar_url,
        emailVerified: false
      };
      await cacheOAuthProfile('osu', String(p.id), {
        email: mapped.email,
        image: mapped.image
      });
      return mapped;
    }
  };
}

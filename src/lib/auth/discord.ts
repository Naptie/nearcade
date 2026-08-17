import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { cacheOAuthProfile } from './profile-cache';
import type { DiscordProviderConfig } from './providers';

export function discordProvider({ clientId, clientSecret, proxy }: DiscordProviderConfig): GenericOAuthConfig {
  const discordUrl = 'https://discord.com';
  const baseUrl = proxy?.replace(/\/$/, '') ?? discordUrl;

  return {
    providerId: 'discord',
    clientId,
    clientSecret,
    authorizationUrl: `${discordUrl}/oauth2/authorize`,
    tokenUrl: `${baseUrl}/api/oauth2/token`,
    userInfoUrl: `${baseUrl}/api/users/@me`,
    scopes: ['identify', 'email'],
    async mapProfileToUser(profile: Record<string, unknown>) {
      const p = profile as {
        id: string;
        global_name: string | null;
        username: string;
        avatar: string | null;
        email?: string;
      };
      const image = p.avatar
        ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.webp`
        : undefined;
      const mapped = {
        name: p.global_name ?? p.username,
        email: p.email ?? `${p.id}@discord.nearcade`,
        image,
        emailVerified: !!p.email,
        username: p.username
      };
      await cacheOAuthProfile('discord', p.id, {
        email: mapped.email,
        image: mapped.image,
        username: p.username
      });
      return mapped;
    }
  };
}

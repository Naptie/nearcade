import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { cacheOAuthProfile } from './profile-cache';
import type { MicrosoftEntraIdProviderConfig } from './providers';

export function microsoftEntraIdProvider({
  clientId,
  clientSecret,
  issuer
}: MicrosoftEntraIdProviderConfig): GenericOAuthConfig {
  return {
    providerId: 'microsoft-entra-id',
    clientId,
    clientSecret,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    scopes: ['openid', 'profile', 'email'],
    async mapProfileToUser(profile: Record<string, unknown>) {
      const mapped = {
        name: (profile.name as string) ?? undefined,
        email: profile.email as string,
        image: (profile.picture as string) ?? undefined,
        emailVerified: !!profile.email
      };
      const accountId = String((profile as Record<string, unknown>).id ?? '');
      if (accountId) {
        await cacheOAuthProfile('microsoft-entra-id', accountId, {
          email: mapped.email,
          image: mapped.image
        });
      }
      return mapped;
    }
  };
}

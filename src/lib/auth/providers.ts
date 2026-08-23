import { env } from '$env/dynamic/private';
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { qqProvider } from './qq';
import { githubProvider } from './github';
import { phiraProvider } from './phira';
import { discordProvider } from './discord';
import { microsoftEntraIdProvider } from './microsoft-entra-id';
import { osuProvider } from './osu';
import { divingFishProvider } from './diving-fish';

/**
 * OAuth provider configuration, read once from the environment.
 *
 * Each provider is only registered when its credentials are present, so
 * optional providers can be left unset in local/dev environments without
 * breaking startup or showing dead sign-in buttons.
 *
 * All environment variables are read here — provider modules receive their
 * values via constructor params and never touch `$env` themselves.
 */

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export interface GithubProviderConfig extends ProviderCredentials {
  proxy?: string;
  baseUrl: string;
  apiBaseUrl: string;
}

export interface MicrosoftEntraIdProviderConfig extends ProviderCredentials {
  issuer: string;
}

export interface DiscordProviderConfig extends ProviderCredentials {
  proxy?: string;
}

export interface QqProviderConfig extends ProviderCredentials {
  proxy?: string;
}

const hasCredentials = (id: string | undefined, secret: string | undefined): boolean =>
  !!id?.trim() && !!secret?.trim();

/**
 * Build the list of OAuth providers that are usable given the current
 * environment. Providers without credentials are omitted entirely.
 */
export function registerOAuthProviders(): GenericOAuthConfig[] {
  const providers: GenericOAuthConfig[] = [];

  const github: GithubProviderConfig = {
    clientId: env.AUTH_GITHUB_ID ?? '',
    clientSecret: env.AUTH_GITHUB_SECRET ?? '',
    proxy: env.AUTH_GITHUB_PROXY,
    baseUrl: env.GITHUB_PROXY?.replace(/\/$/, '') ?? 'https://github.com',
    apiBaseUrl: env.GITHUB_API_PROXY?.replace(/\/$/, '') ?? 'https://api.github.com'
  };
  if (hasCredentials(github.clientId, github.clientSecret)) {
    providers.push(githubProvider(github));
  }

  const microsoft: MicrosoftEntraIdProviderConfig = {
    clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID ?? '',
    clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? '',
    issuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ?? ''
  };
  if (hasCredentials(microsoft.clientId, microsoft.clientSecret)) {
    providers.push(microsoftEntraIdProvider(microsoft));
  }

  const discord: DiscordProviderConfig = {
    clientId: env.AUTH_DISCORD_ID ?? '',
    clientSecret: env.AUTH_DISCORD_SECRET ?? '',
    proxy: env.DISCORD_PROXY
  };
  if (hasCredentials(discord.clientId, discord.clientSecret)) {
    providers.push(discordProvider(discord));
  }

  const osu: ProviderCredentials = {
    clientId: env.AUTH_OSU_ID ?? '',
    clientSecret: env.AUTH_OSU_SECRET ?? ''
  };
  if (hasCredentials(osu.clientId, osu.clientSecret)) {
    providers.push(osuProvider(osu));
  }

  const phira: ProviderCredentials = {
    clientId: env.AUTH_PHIRA_ID ?? '',
    clientSecret: env.AUTH_PHIRA_SECRET ?? ''
  };
  if (hasCredentials(phira.clientId, phira.clientSecret)) {
    providers.push(phiraProvider(phira));
  }

  const qq: QqProviderConfig = {
    clientId: env.AUTH_QQ_ID ?? '',
    clientSecret: env.AUTH_QQ_SECRET ?? '',
    proxy: env.AUTH_QQ_PROXY
  };
  if (hasCredentials(qq.clientId, qq.clientSecret)) {
    providers.push(qqProvider(qq));
  }

  const divingFish: ProviderCredentials = {
    clientId: env.AUTH_DIVING_FISH_ID ?? '',
    clientSecret: env.AUTH_DIVING_FISH_SECRET ?? ''
  };
  if (hasCredentials(divingFish.clientId, divingFish.clientSecret)) {
    providers.push(divingFishProvider(divingFish));
  }

  return providers;
}

/**
 * The set of provider IDs that are currently configured. Used for account
 * linking so only enabled providers are trusted.
 */
export function getTrustedOAuthProviders(): string[] {
  return registerOAuthProviders().map((p) => p.providerId);
}

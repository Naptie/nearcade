import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { cacheOAuthProfile } from './profile-cache';
import { getCallbackURI, resolveRedirectURI } from '$lib/utils/index.server';
import type { QqProviderConfig } from './providers';

export interface QQProfile {
  ret?: number;
  msg?: string;
  is_lost: number;
  nickname: string;
  figureurl: string;
  figureurl_1: string;
  figureurl_2: string;
  figureurl_qq_1: string;
  figureurl_qq_2: string;
  gender: string;
  gender_type: number;
  province: string;
  city: string;
  year: string;
  constellation: string;
  is_yellow_vip: number;
  yellow_vip_level: number;
  is_yellow_year_vip: number;
}

export function qqProvider({ clientId, clientSecret, proxy }: QqProviderConfig): GenericOAuthConfig {
  return {
    providerId: 'qq',
    clientId,
    clientSecret,
    authorizationUrl: 'https://graph.qq.com/oauth2.0/authorize',
    tokenUrl: 'https://graph.qq.com/oauth2.0/token',
    userInfoUrl: 'https://graph.qq.com/user/get_user_info',
    authorizationUrlParams: (ctx) => ({
      redirect_uri: resolveRedirectURI(getCallbackURI(ctx.context.baseURL, 'qq'), proxy)
    }),
    async getToken({ code, redirectURI }) {
      const qqRedirectURI = resolveRedirectURI(redirectURI, proxy);
      const url = new URL('https://graph.qq.com/oauth2.0/token');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('client_secret', clientSecret);
      url.searchParams.set('grant_type', 'authorization_code');
      url.searchParams.set('code', code);
      url.searchParams.set('redirect_uri', qqRedirectURI);
      url.searchParams.set('fmt', 'json');
      url.searchParams.set('need_openid', '1');

      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      } catch (cause) {
        throw new Error('QQ OAuth token request failed.', { cause });
      }

      if (!response.ok) {
        throw new Error(`QQ OAuth token request failed with HTTP ${response.status}.`);
      }

      let data: Record<string, unknown>;
      try {
        data = (await response.json()) as Record<string, unknown>;
      } catch (cause) {
        throw new Error('QQ OAuth token response was not valid JSON.', { cause });
      }

      const accessToken = typeof data.access_token === 'string' ? data.access_token : undefined;
      const openid = typeof data.openid === 'string' ? data.openid : undefined;
      if (!accessToken || !openid) {
        const description =
          typeof data.error_description === 'string'
            ? data.error_description
            : typeof data.error === 'string'
              ? data.error
              : 'missing access token or openid';
        throw new Error(`QQ OAuth token response was rejected: ${description}.`);
      }

      return {
        accessToken,
        tokenType: 'bearer',
        refreshToken: data.refresh_token as string | undefined,
        accessTokenExpiresAt: data.expires_in
          ? new Date(Date.now() + (data.expires_in as number) * 1000)
          : undefined,
        raw: data
      };
    },
    async getUserInfo(tokens) {
      const openid = typeof tokens.raw?.openid === 'string' ? tokens.raw.openid : undefined;
      if (!tokens.accessToken || !openid) {
        throw new Error('QQ OAuth profile request is missing credentials.');
      }

      const url = new URL('https://graph.qq.com/user/get_user_info');
      url.searchParams.set('access_token', tokens.accessToken);
      url.searchParams.set('openid', openid);
      url.searchParams.set('oauth_consumer_key', clientId);

      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      } catch (cause) {
        throw new Error('QQ OAuth profile request failed.', { cause });
      }

      if (!response.ok) {
        throw new Error(`QQ OAuth profile request failed with HTTP ${response.status}.`);
      }

      let profile: QQProfile;
      try {
        profile = (await response.json()) as QQProfile;
      } catch (cause) {
        throw new Error('QQ OAuth profile response was not valid JSON.', { cause });
      }

      if (profile.ret !== undefined && profile.ret !== 0) {
        throw new Error(`QQ OAuth profile response was rejected: ${profile.msg || profile.ret}.`);
      }
      if (!profile.nickname) {
        throw new Error('QQ OAuth profile response did not include a nickname.');
      }

      const result = {
        id: openid,
        name: profile.nickname,
        email: openid + '@qq.nearcade',
        image: profile.figureurl_2 ?? profile.figureurl,
        emailVerified: false
      };
      await cacheOAuthProfile('qq', openid, { email: result.email, image: result.image });
      return result;
    }
  };
}

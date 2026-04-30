import { env } from '$env/dynamic/private';
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { cacheOAuthProfile } from './profile-cache';

export interface QQProfile {
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

const getCallbackURI = (baseURL: string) => `${baseURL.replace(/\/$/, '')}/oauth2/callback/qq`;

const resolveRedirectURI = (callbackURI: string) => {
  const proxyTemplate = env.AUTH_QQ_PROXY?.trim();
  if (!proxyTemplate) {
    return callbackURI;
  }

  const callbackUrl = new URL(callbackURI);
  const replacements: Array<[string, string]> = [
    ['{CALLBACK_URI_ENCODED}', encodeURIComponent(callbackURI)],
    ['{CALLBACK_URI}', callbackURI],
    ['{PUBLIC_ORIGIN}', callbackUrl.origin],
    ['{PUBLIC_HOST}', callbackUrl.host]
  ];

  let resolved = proxyTemplate;
  for (const [token, value] of replacements) {
    resolved = resolved.replaceAll(token, value);
  }

  return resolved;
};

export function qqProvider(): GenericOAuthConfig {
  const clientId = env.AUTH_QQ_ID!;
  const clientSecret = env.AUTH_QQ_SECRET!;

  return {
    providerId: 'qq',
    clientId,
    clientSecret,
    authorizationUrl: 'https://graph.qq.com/oauth2.0/authorize',
    tokenUrl: 'https://graph.qq.com/oauth2.0/token',
    userInfoUrl: 'https://graph.qq.com/user/get_user_info',
    authorizationUrlParams: (ctx) => ({
      redirect_uri: resolveRedirectURI(getCallbackURI(ctx.context.baseURL))
    }),
    async getToken({ code, redirectURI }) {
      const qqRedirectURI = resolveRedirectURI(redirectURI);
      const url = new URL('https://graph.qq.com/oauth2.0/token');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('client_secret', clientSecret);
      url.searchParams.set('grant_type', 'authorization_code');
      url.searchParams.set('code', code);
      url.searchParams.set('redirect_uri', qqRedirectURI);
      url.searchParams.set('fmt', 'json');
      url.searchParams.set('need_openid', '1');

      const response = await fetch(url);
      const data = (await response.json()) as Record<string, unknown>;

      return {
        accessToken: data.access_token as string,
        tokenType: 'bearer',
        refreshToken: data.refresh_token as string | undefined,
        accessTokenExpiresAt: data.expires_in
          ? new Date(Date.now() + (data.expires_in as number) * 1000)
          : undefined,
        raw: data
      };
    },
    async getUserInfo(tokens) {
      const openid = (tokens.raw?.openid as string) ?? '';
      const url = new URL('https://graph.qq.com/user/get_user_info');
      url.searchParams.set('access_token', tokens.accessToken!);
      url.searchParams.set('openid', openid);
      url.searchParams.set('oauth_consumer_key', clientId);

      const response = await fetch(url);
      const profile = (await response.json()) as QQProfile;

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

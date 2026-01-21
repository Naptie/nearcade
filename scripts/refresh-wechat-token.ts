import { createClient } from 'redis';
import dotenv from 'dotenv';

if (!process.env.WECHAT_APPID) {
  dotenv.config();
}

const { REDIS_URI, WECHAT_APPID, WECHAT_SECRET } = process.env;

if (!REDIS_URI || !WECHAT_APPID || !WECHAT_SECRET) {
  console.error(
    '[WeChat Token] Missing environment variables: REDIS_URI, WECHAT_APPID, or WECHAT_SECRET'
  );
  process.exit(1);
}

const redis = createClient({ url: REDIS_URI });

redis.on('error', (err) => console.error('[WeChat Token] Redis Client Error', err));

async function fetchAccessToken() {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WECHAT_APPID}&secret=${WECHAT_SECRET}`;
  const response = await fetch(url);
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };

  if (data.errcode) {
    throw new Error(`WeChat API Error: ${data.errcode} - ${data.errmsg}`);
  }

  return data;
}

async function updateToken() {
  try {
    console.log('[WeChat Token] Fetching new WeChat access token...');
    const data = await fetchAccessToken();

    if (data.access_token && data.expires_in) {
      const key = 'nearcade:wechat:access_token';
      // Store in Redis, expire it slightly after the next scheduled refresh,
      // but before it actually expires on WeChat side to be safe?
      // Actually, standard practice: Redis TTL = WeChat TTL.
      // Refresh process ensures we always have a valid one.
      await redis.set(key, data.access_token, {
        EX: data.expires_in
      });
      console.log(`[WeChat Token] Token updated. Expires in ${data.expires_in} seconds.`);

      // Schedule next refresh 10 minutes before expiration
      const nextRefresh = (data.expires_in - 600) * 1000;
      console.log(`[WeChat Token] Next refresh in ${nextRefresh / 1000} seconds.`);
      setTimeout(updateToken, nextRefresh);
    }
  } catch (error) {
    console.error('[WeChat Token] Failed to update token:', error);
    // Retry in 1 minute if failed
    setTimeout(updateToken, 60000);
  }
}

async function main() {
  await redis.connect();
  await updateToken();
}

main();

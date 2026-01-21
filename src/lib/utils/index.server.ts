import { env } from '$env/dynamic/public';
import type { ShopSource } from '$lib/constants';
import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import type { Shop } from '$lib/types';
import { ObjectId } from 'mongodb';

export const getHost = (request: Request) => {
  // Determine the host for the bind URL
  let host: string | undefined = env.PUBLIC_HOST;
  if (!host) {
    // Fall back to the Host header
    const hostHeader = request.headers.get('host');
    if (hostHeader) {
      // Determine protocol from X-Forwarded-Proto header (set by reverse proxies)
      // Default to https in production, http only for localhost development
      const forwardedProto = request.headers.get('x-forwarded-proto');
      const isSecure =
        forwardedProto === 'https' || (!forwardedProto && !hostHeader.startsWith('localhost:'));
      host = `${isSecure ? 'https' : 'http'}://${hostHeader}`;
    }
  }
  return host;
};

export const getCurrentAttendance = async (userId: string) => {
  const attendancePattern = `nearcade:attend:*:${userId}:*`;
  const db = mongo.db();
  const shopsCollection = db.collection<Shop>('shops');

  await ensureConnected();
  const keys = await redis.keys(attendancePattern);

  if (keys.length > 0) {
    const keyParts = keys[0].split(':');
    const [source, id] = keyParts[2].split('-');
    const attendedAt = new Date(decodeURIComponent(keyParts[4]));
    const visitingShop = await shopsCollection.findOne({
      source: source as ShopSource,
      id: parseInt(id)
    });
    if (visitingShop) {
      return { shop: visitingShop, attendedAt };
    }
  }
  return null;
};

export const sendWeChatTemplateMessage = async (
  userId: string | undefined,
  templateId: string,
  data: Record<string, string>,
  url?: string
) => {
  const db = mongo.db();
  const accountsCollection = db.collection('accounts');
  const userAccount = await accountsCollection.findOne({
    userId: new ObjectId(userId),
    provider: 'wechat'
  });
  if (userAccount && userAccount.providerAccountId) {
    const openId = userAccount.providerAccountId;

    await ensureConnected();
    const accessToken = await redis.get('nearcade:wechat:access_token');

    if (!accessToken) {
      console.error('WeChat access token not found in Redis');
      return;
    }

    const formattedData: Record<string, { value: string }> = {};
    for (const [key, value] of Object.entries(data)) {
      formattedData[key] = { value };
    }

    const body = {
      touser: openId,
      template_id: templateId,
      url,
      data: formattedData
    };

    console.log(body);

    try {
      const response = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${accessToken}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      );
      const result = await response.json();
      console.log('WeChat template message result:', result);
    } catch (error) {
      console.error('Error sending WeChat template message:', error);
    }
  }
};

import { env } from '$env/dynamic/public';
import type { User } from '$lib/auth/types';
import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { m } from '$lib/paraglide/messages';
import type { Shop } from '$lib/types';
import { error } from 'console';
import { MongoClient, ObjectId } from 'mongodb';
import { hasBoundPhone } from '.';

export const getOrigin = (request: Request) => {
  // Determine the origin for the bind URL
  let origin: string | undefined = env.PUBLIC_ORIGIN;
  if (!origin) {
    // Fall back to the Host header
    const hostHeader = request.headers.get('host');
    if (hostHeader) {
      // Determine protocol from X-Forwarded-Proto header (set by reverse proxies)
      // Default to https in production, http only for localhost development
      const forwardedProto = request.headers.get('x-forwarded-proto');
      const isSecure =
        forwardedProto === 'https' || (!forwardedProto && !hostHeader.startsWith('localhost:'));
      origin = `${isSecure ? 'https' : 'http'}://${hostHeader}`;
    }
  }
  return origin;
};

export const getCallbackURI = (baseURL: string, provider: string) =>
  `${baseURL.replace(/\/$/, '')}/oauth2/callback/${provider}`;

export const resolveRedirectURI = (callbackURI: string, template: string) => {
  const proxyTemplate = template.trim();
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

export const initDatabase = async (mongo: MongoClient) => {
  const db = mongo.db();

  await Promise.all([
    // users
    db.collection('users').createIndex({ id: 1 }, { name: 'id_1', unique: true }),

    // shops
    db.collection('shops').createIndex({ id: 1 }, { name: 'id_1', unique: true }),
    db.collection('shops').createIndex({ location: '2dsphere' }, { name: 'location_2dsphere' }),

    // machines
    db.collection('machines').createIndex({ id: 1 }, { name: 'id_1', unique: true }),
    db.collection('machines').createIndex({ apiSecret: 1 }, { name: 'apiSecret_1' }),

    // queues
    db
      .collection('queues')
      .createIndex({ updatedAt: 1 }, { name: 'updatedAt_ttl', expireAfterSeconds: 86400 }),

    // accounts
    db
      .collection('accounts')
      .createIndex({ userId: 1, providerId: 1 }, { name: 'userId_1_providerId_1' }),

    // notifications
    db
      .collection('notifications')
      .createIndex({ targetUserId: 1, readAt: 1 }, { name: 'targetUserId_1_readAt_1' }),

    // club_members
    db
      .collection('club_members')
      .createIndex({ userId: 1, clubId: 1 }, { name: 'userId_1_clubId_1' }),

    // university_members
    db
      .collection('university_members')
      .createIndex({ userId: 1, universityId: 1 }, { name: 'userId_1_universityId_1' }),

    // posts
    db.collection('posts').createIndex({ id: 1 }, { name: 'id_1', unique: true }),

    // comments
    db.collection('comments').createIndex({ id: 1 }, { name: 'id_1', unique: true }),

    // clubs
    db.collection('clubs').createIndex({ id: 1 }, { name: 'id_1', unique: true }),
    db.collection('clubs').createIndex({ slug: 1 }, { name: 'slug_1' }),

    // images
    db.collection('images').createIndex({ id: 1 }, { name: 'id_1', unique: true }),

    // universities
    db.collection('universities').createIndex({ id: 1 }, { name: 'id_1', unique: true }),
    db
      .collection('universities')
      .createIndex(
        { _id: 1, 'campuses.latitude': 1, 'campuses.longitude': 1 },
        { name: 'campus_index', unique: true }
      ),

    // regions
    db.collection('regions').createIndex({ id: 1 }, { name: 'id_1' }),
    db.collection('regions').createIndex({ level: 1 }, { name: 'level_1' }),
    db.collection('regions').createIndex({ parentId: 1 }, { name: 'parentId_1' })
  ]);
};

export const getCurrentAttendance = async (userId: string) => {
  const attendancePattern = `nearcade:attend:*:${userId}:*`;
  const db = mongo.db();
  const shopsCollection = db.collection<Shop>('shops');

  await ensureConnected();
  const keys = await redis.keys(attendancePattern);

  if (keys.length > 0) {
    const keyParts = keys[0].split(':');
    const id = keyParts[2];
    const attendedAt = new Date(decodeURIComponent(keyParts[4]));
    const visitingShop = await shopsCollection.findOne({
      id: parseInt(id)
    });
    if (visitingShop) {
      return { shop: visitingShop, attendedAt };
    }
  }
  return null;
};

export const requireBoundPhone = (user?: User | null): void => {
  if (user?.userType === 'site_admin') {
    return;
  }
  if (!hasBoundPhone(user)) {
    error(403, m.phone_binding_required());
  }
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
    providerId: 'wechat'
  });
  if (userAccount && userAccount.accountId) {
    const openId = userAccount.accountId;

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

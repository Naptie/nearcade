import { error, fail } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import type { PageServerLoad, Actions } from './$types';
import { auth } from '$lib/auth/index.server';
import { m } from '$lib/paraglide/messages';
import mongo from '$lib/db/index.server';
import { storeQrToken, QR_SESSION_TTL } from '$lib/auth/session-qr.server';
import { lookupIpRegion } from '$lib/endpoints/ip-lookup.server';
import QRCode from 'qrcode';
import { getOrigin } from '$lib/utils/index.server';
import { ObjectId, type WithId } from 'mongodb';

/** Friendly label extracted from a User-Agent string */
function parseUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Unknown';
  // Simple pattern: pick the last "named" product token that isn't a generic one.
  const browsers = [
    [/Edg\//, 'Microsoft Edge'],
    [/OPR\/|Opera\//, 'Opera'],
    [/Chrome\//, 'Chrome'],
    [/Firefox\//, 'Firefox'],
    [/Safari\//, 'Safari'],
    [/MSIE |Trident\//, 'Internet Explorer']
  ] as [RegExp, string][];

  for (const [pattern, name] of browsers) {
    if (pattern.test(ua)) {
      const platforms: [RegExp, string][] = [
        [/Android/, ' · Android'],
        [/iPhone|iPad|iPod/, ' · iOS'],
        [/Windows/, ' · Windows'],
        [/Macintosh|Mac OS X/, ' · macOS'],
        [/Linux/, ' · Linux']
      ];
      for (const [pp, pname] of platforms) {
        if (pp.test(ua)) return `${name}${pname}`;
      }
      return name;
    }
  }
  // Fallback: first token
  return ua.split(/[\s/]/)[0] ?? 'Unknown';
}

export type OAuthTokenItem = {
  id: string;
  clientId: string;
  clientName: string;
  clientIcon: string | null;
  clientUri: string | null;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date | null;
};

type OAuthConsentRecord = WithId<{
  id?: string;
  userId: ObjectId;
  clientId: string;
  referenceId?: string | null;
  scopes?: string[] | string;
  consentGiven?: boolean;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
}>;

type OAuthClientRecord = {
  clientId: string;
  name?: string | null;
  icon?: string | null;
  uri?: string | null;
};

export type SessionItem = {
  id: string;
  token: string;
  ipAddress: string | null;
  ipRegion: string | null;
  userAgent: string | null;
  userAgentLabel: string;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
};

export const load: PageServerLoad = async ({ parent, request }) => {
  const { user } = await parent();

  if (!user) {
    error(401, m.unauthorized());
  }

  // --- Cookie-based sessions ---
  const rawSessions = await auth.api.listSessions({
    headers: request.headers
  });

  // Determine current session token from the active session header cookie.
  const currentSession = await auth.api.getSession({ headers: request.headers });
  const currentToken = currentSession?.session?.token ?? null;

  const uniqueIps = [...new Set((rawSessions ?? []).map((s) => s.ipAddress).filter(Boolean))];
  const ipRegionEntries = await Promise.all(
    uniqueIps.map(async (ip) => [ip, await lookupIpRegion(ip as string, request)] as const)
  );
  const ipRegionMap = new Map(ipRegionEntries);

  const sessions: SessionItem[] = (rawSessions ?? []).map((s) => ({
    id: s.id,
    token: s.token,
    ipAddress: s.ipAddress ?? null,
    ipRegion: s.ipAddress ? (ipRegionMap.get(s.ipAddress)?.display ?? null) : null,
    userAgent: s.userAgent ?? null,
    userAgentLabel: parseUserAgent(s.userAgent),
    createdAt: new Date(s.createdAt),
    expiresAt: new Date(s.expiresAt),
    isCurrent: s.token === currentToken
  }));

  // Sort: current first, then most recent
  sessions.sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  // --- OAuth app consents ---
  const db = mongo.db();
  const consentDocs = await db
    .collection<OAuthConsentRecord>('oauth_consents')
    .find({ userId: new ObjectId(user.id), consentGiven: { $ne: false } })
    .sort({ createdAt: -1 })
    .toArray();

  // Fetch client names for the consents
  const clientIds = [...new Set(consentDocs.map((t) => t.clientId).filter(Boolean))];
  const clientDocs = clientIds.length
    ? await db
        .collection<OAuthClientRecord>('oauth_clients')
        .find({ clientId: { $in: clientIds } })
        .project({ clientId: 1, name: 1, icon: 1, uri: 1, _id: 0 })
        .toArray()
    : [];
  const clientMetaMap = new Map<string, { name: string; icon: string | null; uri: string | null }>(
    clientDocs.map((c) => [
      c.clientId,
      { name: c.name ?? c.clientId, icon: c.icon ?? null, uri: c.uri ?? null }
    ])
  );

  const oauthTokens: OAuthTokenItem[] = consentDocs.map((t) => ({
    id: t.id ?? t._id.toString(),
    clientId: t.clientId,
    clientName: clientMetaMap.get(t.clientId)?.name ?? t.clientId,
    clientIcon: clientMetaMap.get(t.clientId)?.icon ?? null,
    clientUri: clientMetaMap.get(t.clientId)?.uri ?? null,
    scopes:
      typeof t.scopes === 'string'
        ? t.scopes.split(/[\s,]+/).filter(Boolean)
        : Array.isArray(t.scopes)
          ? t.scopes
          : [],
    createdAt: new Date(t.createdAt),
    updatedAt: t.updatedAt ? new Date(t.updatedAt) : null
  }));

  return {
    sessions,
    oauthTokens,
    qrTtl: QR_SESSION_TTL
  };
};

export const actions: Actions = {
  revokeSession: async ({ request, locals }) => {
    const session = locals.session;
    if (!session?.user) {
      return fail(401, { message: 'unauthorized' });
    }

    const formData = await request.formData();
    const token = formData.get('token')?.toString();
    if (!token) {
      return fail(400, { message: 'sessions_error_revoking' });
    }

    try {
      await auth.api.revokeSession({
        headers: request.headers,
        body: { token }
      });
      return { success: true, message: 'sessions_revoked' };
    } catch (err) {
      console.error('[sessions] revokeSession error:', err);
      return fail(500, { message: 'sessions_error_revoking' });
    }
  },

  revokeOtherSessions: async ({ request, locals }) => {
    const session = locals.session;
    if (!session?.user) {
      return fail(401, { message: 'unauthorized' });
    }

    try {
      await auth.api.revokeOtherSessions({
        headers: request.headers
      });
      return { success: true, message: 'sessions_all_others_revoked' };
    } catch (err) {
      console.error('[sessions] revokeOtherSessions error:', err);
      return fail(500, { message: 'sessions_error_revoking' });
    }
  },

  revokeOAuthToken: async ({ request, locals }) => {
    const session = locals.session;
    if (!session?.user) {
      return fail(401, { message: 'unauthorized' });
    }

    const formData = await request.formData();
    const tokenId = formData.get('tokenId')?.toString();
    if (!tokenId) {
      return fail(400, { message: 'sessions_error_revoking' });
    }

    try {
      const db = mongo.db();
      const consentFilter = ObjectId.isValid(tokenId)
        ? {
            userId: new ObjectId(session.user.id),
            $or: [{ id: tokenId }, { _id: new ObjectId(tokenId) }]
          }
        : {
            userId: new ObjectId(session.user.id),
            id: tokenId
          };

      const deleteFromPlural = await db
        .collection<OAuthConsentRecord>('oauth_consents')
        .deleteOne(consentFilter);

      if (!deleteFromPlural.deletedCount) {
        await db.collection<OAuthConsentRecord>('oauth_consent').deleteOne(consentFilter);
      }

      return { success: true, message: 'sessions_oauth_revoked' };
    } catch (err) {
      console.error('[sessions] revokeOAuthToken error:', err);
      return fail(500, { message: 'sessions_error_revoking' });
    }
  },

  generateQr: async ({ request, locals }) => {
    const session = locals.session;
    if (!session?.user) {
      return fail(401, { message: 'unauthorized' });
    }

    const token = randomBytes(32).toString('hex');
    await storeQrToken(token, session.user.id);

    const origin = getOrigin(request);
    const callbackUrl = `${origin}/auth/session-qr?t=${token}`;

    // Generate QR code as an SVG data URL for inline display
    const svgString = await QRCode.toString(callbackUrl, {
      type: 'svg',
      margin: 1,
      width: 220,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    return {
      success: true,
      qr: {
        svg: svgString,
        url: callbackUrl,
        expiresAt: new Date(Date.now() + QR_SESSION_TTL * 1000).toISOString()
      }
    };
  }
};

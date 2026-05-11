import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { apiKey } from '@better-auth/api-key';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { customSession } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { ObjectId } from 'mongodb';
import { generateValidUsername } from '$lib/utils';
import mongo from '$lib/db/index.server';
import {
  countUnreadNotifications,
  countPendingJoinRequests
} from '$lib/notifications/index.server';
import { qqProvider } from './qq';
import { githubProvider } from './github';
import { phiraProvider } from './phira';
import type { User } from './types';
import { cacheOAuthProfile, getCachedOAuthProfile } from './profile-cache';

const lastActiveUpdates = new Map<string, number>();
const LAST_ACTIVE_DEBOUNCE_MS = 60_000;

function withProfileCache<T extends Record<string, unknown>>(
  providerId: string,
  mapFn: (profile: T) => { email: string; image?: string; [key: string]: unknown }
) {
  return async (profile: T) => {
    const mapped = mapFn(profile);
    const accountId = String((profile as Record<string, unknown>).id ?? '');
    if (accountId) {
      await cacheOAuthProfile(providerId, accountId, { email: mapped.email, image: mapped.image });
    }
    return mapped;
  };
}

function discordProvider() {
  const discordUrl = 'https://discord.com';
  const proxy = env.DISCORD_PROXY?.replace(/\/$/, '');
  const baseUrl = proxy ?? discordUrl;

  return {
    providerId: 'discord',
    clientId: env.AUTH_DISCORD_ID!,
    clientSecret: env.AUTH_DISCORD_SECRET!,
    authorizationUrl: `${discordUrl}/oauth2/authorize`,
    tokenUrl: `${baseUrl}/api/oauth2/token`,
    userInfoUrl: `${baseUrl}/api/users/@me`,
    scopes: ['identify', 'email'],
    mapProfileToUser: withProfileCache('discord', (profile: Record<string, unknown>) => {
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
      return {
        name: p.global_name ?? p.username,
        email: p.email ?? `${p.id}@discord.nearcade`,
        image,
        emailVerified: !!p.email
      };
    })
  };
}

function microsoftEntraIdProvider() {
  const issuer = env.AUTH_MICROSOFT_ENTRA_ID_ISSUER!;
  return {
    providerId: 'microsoft-entra-id',
    clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID!,
    clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    scopes: ['openid', 'profile', 'email'],
    mapProfileToUser: withProfileCache('microsoft-entra-id', (profile: Record<string, unknown>) => {
      return {
        name: (profile.name as string) ?? undefined,
        email: profile.email as string,
        image: (profile.picture as string) ?? undefined
      };
    })
  };
}

function osuProvider() {
  return {
    providerId: 'osu',
    clientId: env.AUTH_OSU_ID!,
    clientSecret: env.AUTH_OSU_SECRET!,
    authorizationUrl: 'https://osu.ppy.sh/oauth/authorize',
    tokenUrl: 'https://osu.ppy.sh/oauth/token',
    userInfoUrl: 'https://osu.ppy.sh/api/v2/me',
    scopes: ['identify'],
    mapProfileToUser: withProfileCache('osu', (profile: Record<string, unknown>) => {
      const p = profile as { id: number; username: string; avatar_url: string };
      return {
        name: p.username,
        email: `${p.id}@osu.nearcade`,
        image: p.avatar_url,
        emailVerified: false
      };
    })
  };
}

const allowedOrigins = env.ALLOWED_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean) || [];

const allowedHosts = allowedOrigins
  .map((origin) => {
    try {
      return new URL(origin).host.trim();
    } catch {
      return null;
    }
  })
  .filter((host): host is string => !!host);

export const auth = betterAuth({
  baseURL: {
    allowedHosts,
    fallback: allowedOrigins[0],
    protocol: 'auto'
  },
  basePath: '/api/auth',
  trustedOrigins: ['*'],
  advanced: {
    trustedProxyHeaders: true
  },
  database: mongodbAdapter(mongo.db(), {
    usePlural: true
  }),
  account: {
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
      trustedProviders: ['qq', 'github', 'microsoft-entra-id', 'phira', 'osu', 'discord']
    }
  },
  user: {
    additionalFields: {
      displayName: { type: 'string', required: false },
      userType: { type: 'string', required: false },
      bio: { type: 'string', required: false },
      joinedAt: { type: 'date', required: false, input: false },
      lastActiveAt: { type: 'date', required: false, input: false },
      frequentingArcades: { type: 'json', required: false, input: false },
      starredArcades: { type: 'json', required: false, input: false },
      autoDiscovery: { type: 'json', required: false, input: false },
      isEmailPublic: { type: 'boolean', required: false },
      isActivityPublic: { type: 'boolean', required: false },
      isFootprintPublic: { type: 'boolean', required: false },
      isUniversityPublic: { type: 'boolean', required: false },
      isFrequentingArcadePublic: { type: 'boolean', required: false },
      isStarredArcadePublic: { type: 'boolean', required: false },
      notificationTypes: { type: 'json', required: false, input: false },
      fcmTokens: { type: 'json', required: false, input: false },
      fcmTokenUpdatedAt: { type: 'date', required: false, input: false },
      socialLinks: { type: 'json', required: false, input: false }
    },
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        const db = mongo.db();
        const universityMembersCollection = db.collection('university_members');
        const clubMembersCollection = db.collection('club_members');
        const joinRequestsCollection = db.collection('join_requests');

        // Delete university memberships
        await universityMembersCollection.deleteMany({ userId: user.id });

        // Delete club memberships
        await clubMembersCollection.deleteMany({ userId: user.id });

        // Delete join requests
        await joinRequestsCollection.deleteMany({ userId: user.id });
      }
    }
  },
  plugins: [
    genericOAuth({
      config: [
        qqProvider(),
        githubProvider(),
        microsoftEntraIdProvider(),
        phiraProvider(),
        osuProvider(),
        discordProvider()
      ]
    }),
    apiKey({
      defaultPrefix: 'nk_',
      defaultKeyLength: 42,
      enableMetadata: true,
      maximumNameLength: 50,
      requireName: true,
      rateLimit: {
        enabled: false
      }
    }),
    customSession(async ({ user, session }) => {
      const userId = user.id;

      const now = Date.now();
      const lastUpdate = lastActiveUpdates.get(userId) ?? 0;
      if (now - lastUpdate > LAST_ACTIVE_DEBOUNCE_MS) {
        lastActiveUpdates.set(userId, now);
        const db = mongo.db();
        await db
          .collection('users')
          .updateOne({ _id: new ObjectId(userId) }, { $set: { lastActiveAt: new Date() } });
      }

      return {
        user,
        session: {
          ...session,
          unreadNotifications: await countUnreadNotifications(mongo, userId),
          pendingJoinRequests: await countPendingJoinRequests(mongo, userId)
        }
      };
    }),
    sveltekitCookies(getRequestEvent)
  ],
  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          const profile = await getCachedOAuthProfile(account.providerId, account.accountId);
          if (!profile) return;

          const db = mongo.db();
          const currentUser = await db
            .collection('users')
            .findOne({ _id: new ObjectId(account.userId) });
          if (!currentUser) return;

          const updates: Record<string, unknown> = {};
          const hasPlaceholderEmail = !currentUser.email || currentUser.email.endsWith('.nearcade');
          const hasRealNewEmail = profile.email && !profile.email.endsWith('.nearcade');
          if (hasPlaceholderEmail && hasRealNewEmail) {
            updates.email = profile.email;
            updates.emailVerified = true;
          }
          if (!currentUser.image && profile.image) {
            updates.image = profile.image;
          }

          if (Object.keys(updates).length > 0) {
            await db
              .collection('users')
              .updateOne({ _id: new ObjectId(account.userId) }, { $set: updates });
          }
        }
      }
    },
    user: {
      create: {
        after: async (user) => {
          const db = mongo.db();
          const usersCollection = db.collection<User>('users');

          const name = user.name ?? null;
          let username: string;
          if (name && /^[A-Za-z0-9_-]+$/.test(name)) {
            const existingUser = await usersCollection.findOne({
              name,
              _id: { $ne: new ObjectId(user.id) }
            });
            if (!existingUser) {
              username = name;
            } else {
              username = await generateValidUsername(name, user.id, usersCollection);
            }
          } else {
            username = await generateValidUsername(name, user.id, usersCollection);
          }

          await usersCollection.updateOne(
            { _id: new ObjectId(user.id) },
            {
              $set: {
                name: username,
                displayName: user.name,
                joinedAt: new Date(),
                lastActiveAt: new Date(),
                isEmailPublic: false,
                isActivityPublic: true,
                isFootprintPublic: false,
                isUniversityPublic: true,
                isFrequentingArcadePublic: true,
                isStarredArcadePublic: true
              }
            }
          );
        }
      }
    }
  }
});

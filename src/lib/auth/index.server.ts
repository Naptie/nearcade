/* eslint-disable @typescript-eslint/no-unused-vars */
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
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

const lastActiveUpdates = new Map<string, number>();
const LAST_ACTIVE_DEBOUNCE_MS = 60_000;

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
    scopes: ['identify', 'email']
  };
}

function microsoftEntraIdProvider() {
  const issuer = env.AUTH_MICROSOFT_ENTRA_ID_ISSUER!;
  return {
    providerId: 'microsoft-entra-id',
    clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID!,
    clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    scopes: ['openid', 'profile', 'email']
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
    scopes: ['identify']
  };
}

export const auth = betterAuth({
  basePath: '/api/auth',
  trustedOrigins: ['*'],
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
    customSession(async ({ user, session }) => {
      const userId = user.id;
      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      const dbUser = await usersCollection.findOne({
        _id: new ObjectId(userId)
      });

      if (!dbUser) {
        return {
          user,
          session: {
            ...session,
            unreadNotifications: 0,
            pendingJoinRequests: 0
          }
        };
      }

      const now = Date.now();
      const lastUpdate = lastActiveUpdates.get(userId) ?? 0;
      if (now - lastUpdate > LAST_ACTIVE_DEBOUNCE_MS) {
        lastActiveUpdates.set(userId, now);
        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { lastActiveAt: new Date() } }
        );
      }

      const {
        _id,
        email,
        id: _dbId,
        emailVerified: _ev,
        createdAt: _ca,
        updatedAt: _ua,
        ...rest
      } = dbUser;
      const enrichedUser = {
        ...rest,
        _id: userId,
        id: userId,
        email: email || '',
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      };

      return {
        user: enrichedUser,
        session: {
          ...session,
          unreadNotifications: await countUnreadNotifications(mongo, userId),
          pendingJoinRequests: await countPendingJoinRequests(mongo, enrichedUser as User)
        }
      };
    }),
    sveltekitCookies(getRequestEvent)
  ],
  databaseHooks: {
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
      },
      update: {
        before: async (user) => {
          // Allow Better Auth to update email from fake QQ address to real one
          if (user.email && !user.email.endsWith('@qq.nearcade')) {
            return { data: user as Record<string, unknown> };
          }
        }
      }
    }
  }
});

import { MongoDBAdapter } from '@auth/mongodb-adapter';
import { SvelteKitAuth, type User } from '@auth/sveltekit';
import GitHub from '@auth/sveltekit/providers/github';
import MicrosoftEntraID from '@auth/sveltekit/providers/microsoft-entra-id';
import Osu from '@auth/sveltekit/providers/osu';
import client from './db.server';
import Discord from '@auth/sveltekit/providers/discord';
import QQ from './auth/qq';
import { AUTH_QQ_PROXY } from '$env/static/private';
import { ObjectId } from 'mongodb';
import { generateValidUsername } from './utils';
import Phira from './auth/phira';
import { countUserNotifications, countPendingJoinRequests } from './notifications.server';

const config = { allowDangerousEmailAccountLinking: true };

export const { handle, signIn, signOut } = SvelteKitAuth({
  providers: [
    QQ({
      ...config,
      redirectProxyUrl: AUTH_QQ_PROXY
    }),
    GitHub(config),
    MicrosoftEntraID(config),
    Discord(config),
    Phira(config),
    Osu(config)
  ],
  adapter: MongoDBAdapter(client, {
    databaseName: undefined,
    collections: {
      Users: 'users',
      Accounts: 'accounts',
      Sessions: 'sessions',
      VerificationTokens: 'verification_tokens'
    }
  }),
  trustHost: true,
  callbacks: {
    session: async ({ session, user }) => {
      const userId = session.userId;
      user.lastActiveAt = new Date();
      const db = client.db();
      const usersCollection = db.collection<User>('users');

      const dbUser: User | null = await usersCollection.findOne({
        _id: new ObjectId(userId)
      });

      if (dbUser) {
        const signUp = !dbUser.joinedAt;
        dbUser.lastActiveAt = user.lastActiveAt;
        if (signUp) {
          // First time signup - set up user data
          dbUser.id = userId;
          dbUser.joinedAt = dbUser.lastActiveAt;
          dbUser.displayName = user.name;

          // Validate and set username
          if (user.name && /^[A-Za-z0-9_-]+$/.test(user.name)) {
            // Check if username is unique
            const existingUser = await usersCollection.findOne({
              name: user.name,
              _id: { $ne: dbUser._id }
            });
            if (!existingUser) {
              dbUser.name = user.name;
            } else {
              dbUser.name = await generateValidUsername(user.name, dbUser._id, usersCollection);
            }
          } else {
            dbUser.name = await generateValidUsername(user.name, dbUser._id, usersCollection);
          }

          // Set default privacy settings
          dbUser.isEmailPublic = false;
          dbUser.isActivityPublic = true;
          dbUser.isFootprintPublic = false;
          dbUser.isUniversityPublic = true;
          dbUser.isFrequentingArcadePublic = true;
          dbUser.isStarredArcadePublic = true;
        }
        const { _id, email, ...rest } = dbUser;
        await usersCollection.updateOne(
          { _id },
          { $set: signUp ? rest : { lastActiveAt: dbUser.lastActiveAt } }
        );
        session.user = {
          _id: userId,
          id: userId,
          email: email || '',
          emailVerified: null,
          ...rest
        };
        session.unreadNotifications = await countUserNotifications(client, user);
        session.pendingJoinRequests = await countPendingJoinRequests(client, user);
      }
      return session;
    }
  }
});

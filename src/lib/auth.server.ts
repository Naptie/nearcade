import { MongoDBAdapter } from '@auth/mongodb-adapter';
import { SvelteKitAuth, type User } from '@auth/sveltekit';
import GitHub from '@auth/sveltekit/providers/github';
import MicrosoftEntraID from '@auth/sveltekit/providers/microsoft-entra-id';
import Osu from '@auth/sveltekit/providers/osu';
import client from './db.server';
import Discord from '@auth/sveltekit/providers/discord';
import { QQ } from './auth/qq';
import { AUTH_QQ_PROXY } from '$env/static/private';
import { ObjectId } from 'mongodb';
import { generateValidUsername } from './utils';
import Phira from './auth/phira';

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
      user.lastActiveAt = new Date();
      const db = client.db();
      const usersCollection = db.collection<User>('users');

      const dbUser: User | null = await usersCollection.findOne({
        _id: new ObjectId(session.userId)
      });

      if (dbUser) {
        dbUser.lastActiveAt = user.lastActiveAt;
        if (!dbUser.joinedAt) {
          // First time signup - set up user data
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
              dbUser.name = await generateValidUsername(
                user.name,
                user.id || 'user',
                usersCollection
              );
            }
          } else {
            dbUser.name = await generateValidUsername(
              user.name,
              user.id || 'user',
              usersCollection
            );
          }

          // Set default privacy settings
          dbUser.isEmailPublic = false;
          dbUser.isUniversityPublic = true;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _id, id: _, email, ...rest } = dbUser;
        const uid = _id!.toString() as string & ObjectId;
        await usersCollection.updateOne(
          { _id: dbUser._id },
          {
            $set: {
              id: uid,
              joinedAt: dbUser.joinedAt,
              lastActiveAt: dbUser.lastActiveAt
            }
          }
        );
        session.user = {
          _id: uid,
          id: uid,
          email: email || '',
          emailVerified: null,
          ...rest
        };
      }
      return session;
    }
  }
});

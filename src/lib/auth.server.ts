import { MongoDBAdapter } from '@auth/mongodb-adapter';
import { SvelteKitAuth } from '@auth/sveltekit';
import GitHub from '@auth/sveltekit/providers/github';
import MicrosoftEntraID from '@auth/sveltekit/providers/microsoft-entra-id';
import Osu from '@auth/sveltekit/providers/osu';
import client from './db.server';
import Discord from '@auth/sveltekit/providers/discord';
import { QQ } from './auth/qq';
import { AUTH_QQ_PROXY } from '$env/static/private';
import Apple from '@auth/sveltekit/providers/apple';

const config = { allowDangerousEmailAccountLinking: true };

export const { handle, signIn, signOut } = SvelteKitAuth({
  providers: [
    QQ({
      ...config,
      redirectProxyUrl: AUTH_QQ_PROXY
    }),
    Apple(config),
    GitHub(config),
    MicrosoftEntraID(config),
    Discord(config),
    Osu(config)
  ],
  adapter: MongoDBAdapter(client),
  trustHost: true
});

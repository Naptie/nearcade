import { MongoDBAdapter } from '@auth/mongodb-adapter';
import { SvelteKitAuth } from '@auth/sveltekit';
import GitHub from '@auth/sveltekit/providers/github';
import Osu from '@auth/sveltekit/providers/osu';
import client from './db.server';

export const { handle, signIn, signOut } = SvelteKitAuth({
  providers: [GitHub, Osu],
  adapter: MongoDBAdapter(client)
});

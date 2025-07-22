import { SvelteKitAuth } from '@auth/sveltekit';
import GitHub from '@auth/sveltekit/providers/github';
import Osu from '@auth/sveltekit/providers/osu';

export const { handle, signIn, signOut } = SvelteKitAuth({
  providers: [GitHub, Osu]
});

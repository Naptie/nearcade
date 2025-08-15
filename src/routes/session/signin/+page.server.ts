import { signIn } from '$lib/auth/index.server';
import type { Actions } from './$types';
export const actions: Actions = { default: signIn };

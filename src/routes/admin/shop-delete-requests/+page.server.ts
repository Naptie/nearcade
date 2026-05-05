import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolve } from '$app/paths';

export const load: PageServerLoad = async () => {
  redirect(301, resolve('/(main)/shops/delete-requests'));
};

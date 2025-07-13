import { loadShops } from '$lib/endpoints/discover.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = loadShops;

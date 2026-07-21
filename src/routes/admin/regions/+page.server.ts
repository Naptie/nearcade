import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Region } from '$lib/regions/types';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

const LEVEL_ORDER: Record<Region['level'], number> = {
  country: 0,
  province: 1,
  city: 2,
  county: 3
};

export const load: PageServerLoad = async ({ locals }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  const db = mongo.db();
  const regions = (await db.collection<Region>('regions').find({}).toArray()) as Region[];

  regions.sort((a, b) => {
    const levelDiff = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (levelDiff !== 0) return levelDiff;
    return a.id.localeCompare(b.id);
  });

  return {
    regions: toPlainArray(regions)
  };
};

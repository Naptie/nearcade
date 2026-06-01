import { json } from '@sveltejs/kit';
import { GAME_TITLES } from '$lib/constants';
import { m } from '$lib/paraglide/messages';
import type { RequestHandler } from './$types';

type GameTitleKey = (typeof GAME_TITLES)[number]['key'];

const getLocalizedTitleName = (key: GameTitleKey): string => {
  try {
    return m[key]();
  } catch {
    return key;
  }
};

export const GET: RequestHandler = async () => {
  return json(
    {
      titles: GAME_TITLES.map((title) => ({
        id: title.id,
        key: title.key,
        name: getLocalizedTitleName(title.key),
        seats: title.seats ?? 1
      }))
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800'
      }
    }
  );
};

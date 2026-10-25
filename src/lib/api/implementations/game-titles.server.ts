import { implement } from '@orpc/server';
import { gameTitlesContract } from '../contracts/game-titles';
import type { ApiContext } from '../context';
import { GAME_TITLES } from '$lib/constants';
import { m } from '$lib/paraglide/messages';

type GameTitleKey = (typeof GAME_TITLES)[number]['key'];

const getLocalizedTitleName = (key: GameTitleKey): string => {
  try {
    return m[key]();
  } catch {
    return key;
  }
};

const impl = implement(gameTitlesContract).$context<ApiContext>();

export const gameTitlesImplementation = {
  list: impl.list.handler(async ({ context }) => {
    context.resHeaders?.set(
      'Cache-Control',
      'public, max-age=86400, stale-while-revalidate=604800'
    );
    return {
      titles: GAME_TITLES.map((title) => ({
        id: title.id,
        key: title.key,
        name: getLocalizedTitleName(title.key),
        seats: title.seats ?? 1
      }))
    };
  })
};
